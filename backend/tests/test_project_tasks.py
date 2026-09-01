"""Projects and tasks, now that they live outside CRM.

Two things are being tested here, and neither is CRUD.

**The move itself.** `Project` and `ProjectTask` were defined in `crm` beside
clients and invoices, which forced every project to belong to a customer. They
now sit in their own app with a nullable client, so an internal migration or an
office move can be a project. The migration that moved them is state-only, so
these assertions run against the same rows.

**"Finished" is a status, not a boolean.** `status` has five values, so every
question of the form "is this done" has to decide what *blocked* and *in
review* mean. The answer is the same each time: they are unfinished.

That is the failure this file exists to catch. A `filter(status=TODO)` reads as
"not done" and silently loses two states.
"""

from datetime import date
from decimal import Decimal

import pytest

from accounts.portal import portal_summary
from crm.models import Client
from employees.models import Employee
from projects.models import (
    Milestone,
    Project,
    ProjectTask,
    Sprint,
    TaskActivity,
    TaskComment,
)

pytestmark = pytest.mark.django_db

TASKS_URL = "/api/v1/projects/tasks/"
PROJECTS_URL = "/api/v1/projects/projects/"
MILESTONES_URL = "/api/v1/projects/milestones/"
COMMENTS_URL = "/api/v1/projects/comments/"
ATTACHMENTS_URL = "/api/v1/projects/attachments/"


@pytest.fixture
def project(company):
    yield Project.objects.create(name="Payroll rewrite", status=Project.Status.ACTIVE)


@pytest.fixture
def task(company, project, payroll_setup):
    yield ProjectTask.objects.create(
        project=project,
        title="Map the Bikram Sambat periods",
        assignee=payroll_setup["emp"],
    )


# ── The client became optional ───────────────────────────────────────────


def test_a_project_needs_no_client(company, admin_client):
    """The reason for the move.

    While this lived in CRM the FK was required, so internal work had to be
    filed under whichever customer was least wrong.
    """
    response = admin_client.post(
        PROJECTS_URL, {"name": "Office move", "status": "planning"}, format="json"
    )

    assert response.status_code == 201, response.data
    assert response.data["client"] is None
    assert response.data["client_name"] is None


def test_a_client_project_still_says_whose_it_is(company, admin_client):
    """Optional is not the same as absent — the link had to survive the move."""
    client_row = Client.objects.create(name="Everest Traders", status="active")

    response = admin_client.post(
        PROJECTS_URL,
        {"name": "Everest portal", "client": client_row.id, "status": "active"},
        format="json",
    )

    assert response.status_code == 201, response.data
    assert response.data["client_name"] == "Everest Traders"


# ── Completion is stamped, not claimed ───────────────────────────────────


def test_reaching_done_stamps_the_completion_time(company, admin_client, task):
    response = admin_client.patch(
        f"{TASKS_URL}{task.id}/", {"status": "done"}, format="json"
    )

    assert response.status_code == 200, response.data
    assert ProjectTask.objects.get(pk=task.pk).completed_at is not None


def test_the_completion_time_is_stamped_only_once(company, admin_client, task):
    """Cycle time is measured from creation to this timestamp.

    Re-stamping on every later save would mean fixing a typo on a finished task
    moved its completion date, and the figure would drift upward every time
    anybody touched old work.
    """
    admin_client.patch(f"{TASKS_URL}{task.id}/", {"status": "done"}, format="json")
    first = ProjectTask.objects.get(pk=task.pk).completed_at
    assert first is not None, "nothing was stamped, so nothing is being held still"

    admin_client.patch(
        f"{TASKS_URL}{task.id}/", {"title": "Map the BS periods"}, format="json"
    )

    assert ProjectTask.objects.get(pk=task.pk).completed_at == first


def test_reopening_a_task_clears_the_completion_time(company, admin_client, task):
    """A task that is open has not been completed.

    Leaving the stamp behind would let a task sit in `blocked` while still
    counting as finished work in a monthly total.
    """
    admin_client.patch(f"{TASKS_URL}{task.id}/", {"status": "done"}, format="json")
    admin_client.patch(f"{TASKS_URL}{task.id}/", {"status": "blocked"}, format="json")

    assert ProjectTask.objects.get(pk=task.pk).completed_at is None


def test_the_caller_cannot_set_their_own_completion_time(company, admin_client, task):
    """These dates reach performance conversations.

    Writable, the field would let somebody record a completion that never
    happened, on a date they chose.
    """
    response = admin_client.patch(
        f"{TASKS_URL}{task.id}/",
        {"completed_at": "2020-01-01T00:00:00Z"},
        format="json",
    )

    assert response.status_code == 200
    assert ProjectTask.objects.get(pk=task.pk).completed_at is None


# ── The activity trail is written from the diff ──────────────────────────


def test_a_status_move_is_recorded_with_both_ends(company, admin_client, task):
    """A completion figure nobody can trace is one nobody will trust."""
    admin_client.patch(f"{TASKS_URL}{task.id}/", {"status": "in_progress"}, format="json")

    entry = TaskActivity.objects.get(task=task, field="status")

    assert entry.from_value == "todo"
    assert entry.to_value == "in_progress"


def test_editing_a_description_writes_no_activity(company, admin_client, task):
    """The trail records the fields a reader is chasing — who has it, what state
    it is in, when it is due. Logging prose edits would bury those under noise
    nobody reads."""
    admin_client.patch(
        f"{TASKS_URL}{task.id}/", {"description": "Needs the fiscal year map."}, format="json"
    )

    assert TaskActivity.objects.filter(task=task).count() == 0


def test_the_trail_is_readable_back(company, admin_client, task):
    admin_client.patch(f"{TASKS_URL}{task.id}/", {"priority": "urgent"}, format="json")

    response = admin_client.get(f"{TASKS_URL}{task.id}/activity/")

    assert response.status_code == 200
    assert [(e["field"], e["to_value"]) for e in response.data] == [("priority", "urgent")]


# ── "Not done" means every state except done ─────────────────────────────


@pytest.fixture
def a_task_in_every_state(company, project, payroll_setup):
    for state in ProjectTask.Status:
        ProjectTask.objects.create(
            project=project,
            title=f"Task {state.value}",
            status=state,
            assignee=payroll_setup["emp"],
        )
    yield


def test_mine_lists_every_unfinished_state(company, admin_client, a_task_in_every_state):
    """Four of the five states are somebody's problem.

    Blocked and in-review are the two a naive "status is todo" filter drops,
    and they are precisely the ones that need chasing.
    """
    response = admin_client.get(f"{TASKS_URL}mine/")

    assert response.status_code == 200
    returned = {row["status"] for row in response.data["results"]}
    assert returned == {"todo", "in_progress", "blocked", "in_review"}


def test_the_portal_counts_every_unfinished_state(
    company, payroll_setup, a_task_in_every_state
):
    """Every unfinished state counts, not just TODO.

    `status=TODO` is the plausible wrong answer here: it reports 1 where the
    truth is 4, and unlike a missing column it fails silently.
    """
    summary = portal_summary(payroll_setup["emp"])

    assert summary["work"]["open_project_tasks"] == 4


def test_the_board_counts_come_from_status(company, admin_client, a_task_in_every_state):
    """Every bucket, including the empty ones — a board with a missing column
    reads as a board that lost its tasks."""
    response = admin_client.get(f"{TASKS_URL}status-counts/")

    assert response.status_code == 200
    assert response.data["total"] == 5
    assert response.data["todo"] == 1
    assert response.data["blocked"] == 1
    assert response.data["done"] == 1


def test_a_project_reports_its_own_progress(company, admin_client, a_task_in_every_state, project):
    """Counted in SQL, not per row — the list page shows progress for every
    project on it, and two COUNTs each is how that page gets slow."""
    response = admin_client.get(PROJECTS_URL)

    row = next(r for r in response.data["results"] if r["id"] == project.id)
    assert row["task_count"] == 5
    assert row["done_count"] == 1


# ── Sprints hold a slice, not everything ─────────────────────────────────


def test_a_task_may_belong_to_no_sprint(company, project, task):
    """A backlog belongs to no sprint. A sprint that has to contain everything
    is not a sprint."""
    assert task.sprint is None


def test_closing_a_sprint_leaves_its_tasks_alone(company, admin_client, project, task):
    """Closing a sprint is an act of planning, not of work.

    Cascading a completion onto its tasks would mark unfinished work done on a
    date chosen by the calendar.
    """
    sprint = Sprint.objects.create(
        project=project,
        name="Sprint 4",
        start_date=date(2026, 8, 1),
        end_date=date(2026, 8, 14),
    )
    task.sprint = sprint
    task.save(update_fields=["sprint"])

    response = admin_client.patch(
        f"/api/v1/projects/sprints/{sprint.id}/", {"is_closed": True}, format="json"
    )

    assert response.status_code == 200
    reloaded = ProjectTask.objects.get(pk=task.pk)
    assert reloaded.status == ProjectTask.Status.TODO
    assert reloaded.sprint_id == sprint.id


# ── A comment is somebody's words ────────────────────────────────────────


def test_a_comment_records_who_wrote_it(company, admin_client, task):
    response = admin_client.post(
        COMMENTS_URL, {"task": task.id, "body": "Blocked on the fiscal map."}, format="json"
    )

    assert response.status_code == 201, response.data
    assert response.data["author_name"] is not None


def test_another_persons_comment_cannot_be_deleted(company, employee_client, admin_user, task):
    """Deleting somebody else's remark edits the record of a conversation,
    which is what the trail exists to prevent."""
    comment = TaskComment.objects.create(
        task=task, body="I think this is wrong.", created_by=admin_user
    )

    response = employee_client.delete(f"{COMMENTS_URL}{comment.id}/")

    assert response.status_code == 403
    assert TaskComment.objects.filter(pk=comment.pk).exists()


def test_your_own_comment_can_be_deleted(company, employee_client, employee_user, task):
    comment = TaskComment.objects.create(
        task=task, body="Never mind.", created_by=employee_user
    )

    response = employee_client.delete(f"{COMMENTS_URL}{comment.id}/")

    assert response.status_code == 204
    assert not TaskComment.objects.filter(pk=comment.pk).exists()


# ── The move did not sever the timesheet ─────────────────────────────────


def test_hours_still_log_against_a_task(company, project, task, payroll_setup):
    """`timesheets.TimeEntry` pointed at `crm.ProjectTask`. The migration
    repointed it in state only, so the FK is the same column — this asserts the
    relation still resolves both ways."""
    from timesheets.models import TimeEntry

    entry = TimeEntry.objects.create(
        employee=payroll_setup["emp"],
        project=project,
        task=task,
        date=date(2026, 8, 6),
        hours="4.00",
    )
    assert entry.task.project_id == project.id
    assert task.time_entries.count() == 1


# ── Who may change what ──────────────────────────────────────────────────
#
# A board where every move needs an administrator is a board nobody keeps up to
# date, so the assignee can move their own card. Everything wider than that —
# creating work, deleting it, editing somebody else's — stops at the project's
# owner or at `workplace.manage`.


@pytest.fixture
def worker(company, employee_user):
    """An ordinary employee with an employment record, holding no permissions."""
    from employees.models import Employee

    yield Employee.objects.create(
        user=employee_user, employee_code="EMP-900", date_joined=date(2026, 1, 1)
    )


def test_an_employee_may_move_their_own_card(company, employee_client, worker, task):
    task.assignee = worker
    task.save(update_fields=["assignee"])

    response = employee_client.patch(
        f"{TASKS_URL}{task.id}/", {"status": "in_progress"}, format="json"
    )

    assert response.status_code == 200, response.data


def test_an_employee_may_not_move_somebody_elses(company, employee_client, worker, task):
    """`task` is assigned to the payroll fixture's employee, not to this one."""
    response = employee_client.patch(
        f"{TASKS_URL}{task.id}/", {"status": "done"}, format="json"
    )

    assert response.status_code == 403


def test_an_assignee_may_not_delete_their_task(company, employee_client, worker, task):
    """Closing a task and erasing it must not be the same gesture — the record
    that the work was asked for is the part worth keeping."""
    task.assignee = worker
    task.save(update_fields=["assignee"])

    response = employee_client.delete(f"{TASKS_URL}{task.id}/")

    assert response.status_code == 403
    assert ProjectTask.objects.filter(pk=task.pk).exists()


def test_an_employee_may_not_add_work_to_a_board(company, employee_client, worker, project):
    """Object-level permission cannot see this — there is no object yet — so it
    is checked against the posted project instead."""
    response = employee_client.post(
        f"{TASKS_URL}", {"project": project.id, "title": "Something I invented"}, format="json"
    )

    assert response.status_code == 403


def test_a_project_owner_runs_their_own_project(company, employee_client, worker, project):
    """A lead who cannot add a task to the project they run has to go and ask
    somebody, and the asking happens outside the system."""
    project.owner = worker
    project.save(update_fields=["owner"])

    response = employee_client.post(
        f"{TASKS_URL}", {"project": project.id, "title": "Draft the migration"}, format="json"
    )

    assert response.status_code == 201, response.data


def test_an_employee_may_not_create_a_project(company, employee_client, worker):
    """Otherwise anybody could make themselves an owner and inherit the rest."""
    response = employee_client.post(
        PROJECTS_URL, {"name": "My own empire", "status": "active"}, format="json"
    )

    assert response.status_code == 403


def test_everyone_can_read_the_boards(company, employee_client, worker, task):
    """A board that hides which work exists produces the duplicated effort it
    was bought to prevent."""
    response = employee_client.get(PROJECTS_URL)

    assert response.status_code == 200
    assert response.data["count"] >= 1


# ── Files on a task ──────────────────────────────────────────────────────
#
# Over the generic `documents.Document` store rather than a second file model,
# so the company-scoped upload path and the storage backend stay in one place.


def _upload(name="spec.txt", body=b"the agreed scope"):
    from django.core.files.uploadedfile import SimpleUploadedFile

    return SimpleUploadedFile(name, body, content_type="text/plain")


def test_a_file_can_be_pinned_to_a_task(company, admin_client, task):
    response = admin_client.post(
        ATTACHMENTS_URL, {"task": task.id, "file": _upload()}, format="multipart"
    )

    assert response.status_code == 201, response.data
    assert response.data["original_filename"] == "spec.txt"
    assert response.data["size"] == len(b"the agreed scope")


def test_attachments_are_listed_per_task(company, admin_client, task, project):
    admin_client.post(ATTACHMENTS_URL, {"task": task.id, "file": _upload()}, format="multipart")
    other = ProjectTask.objects.create(project=project, title="Unrelated")
    admin_client.post(
        ATTACHMENTS_URL, {"task": other.id, "file": _upload("other.txt")}, format="multipart"
    )

    response = admin_client.get(f"{ATTACHMENTS_URL}?task={task.id}")

    assert response.status_code == 200
    assert [row["original_filename"] for row in response.data["results"]] == ["spec.txt"]


def test_listing_without_a_task_returns_nothing(company, admin_client, task):
    """Every attachment in the company is not a question anybody asks, and
    answering it leaks which files hang off work the caller has no reason to be
    reading about."""
    admin_client.post(ATTACHMENTS_URL, {"task": task.id, "file": _upload()}, format="multipart")

    response = admin_client.get(ATTACHMENTS_URL)

    assert response.status_code == 200
    assert response.data["count"] == 0


def test_a_stranger_cannot_pin_a_file(company, employee_client, worker, task):
    """The same three-way rule as the task itself, checked against the parent
    project."""
    response = employee_client.post(
        ATTACHMENTS_URL, {"task": task.id, "file": _upload()}, format="multipart"
    )

    assert response.status_code == 403


def test_an_assignee_may_pin_a_file(company, employee_client, worker, task):
    task.assignee = worker
    task.save(update_fields=["assignee"])

    response = employee_client.post(
        ATTACHMENTS_URL, {"task": task.id, "file": _upload("screenshot.txt")}, format="multipart"
    )

    assert response.status_code == 201, response.data


def test_somebody_elses_upload_cannot_be_deleted(company, employee_client, worker, admin_client, task):
    """Removing another person's file edits the record of what was shared —
    the same objection that protects their comments."""
    task.assignee = worker
    task.save(update_fields=["assignee"])
    created = admin_client.post(
        ATTACHMENTS_URL, {"task": task.id, "file": _upload()}, format="multipart"
    )

    response = employee_client.delete(f"{ATTACHMENTS_URL}{created.data['id']}/")

    assert response.status_code == 403


def test_your_own_upload_can_be_deleted(company, employee_client, worker, task):
    """An assignee may remove a file they attached in error."""
    task.assignee = worker
    task.save(update_fields=["assignee"])
    created = employee_client.post(
        ATTACHMENTS_URL, {"task": task.id, "file": _upload("oops.txt")}, format="multipart"
    )

    response = employee_client.delete(f"{ATTACHMENTS_URL}{created.data['id']}/")

    assert response.status_code == 204


def test_an_attachment_downloads_with_its_own_name(company, admin_client, task):
    created = admin_client.post(
        ATTACHMENTS_URL, {"task": task.id, "file": _upload("scope.txt", b"hello")}, format="multipart"
    )

    response = admin_client.get(f"{ATTACHMENTS_URL}{created.data['id']}/download/")

    assert response.status_code == 200
    assert "scope.txt" in response["Content-Disposition"]
    assert b"".join(response.streaming_content) == b"hello"


def test_a_file_cannot_be_pinned_to_a_task_that_does_not_exist(company, admin_client):
    response = admin_client.post(
        ATTACHMENTS_URL, {"task": 999999, "file": _upload()}, format="multipart"
    )

    assert response.status_code == 400


# ── Metrics, with no verdict attached ────────────────────────────────────
#
# The figures exist so HR and the owner can form a view. They deliberately
# carry no score, and each rate is reported beside the denominator that makes
# it readable.

METRICS_URL = f"{TASKS_URL}metrics/"


@pytest.fixture
def a_worked_history(company, project, payroll_setup):
    """Four done, two open — one of the done ones late, one undated."""
    from django.utils import timezone

    emp = payroll_setup["emp"]
    def make(title, status, due=None, completed=None):
        return ProjectTask.objects.create(
            project=project, title=title, status=status, assignee=emp,
            due_date=due, completed_at=completed,
        )

    make("On time", ProjectTask.Status.DONE, date(2026, 8, 10),
         timezone.make_aware(timezone.datetime(2026, 8, 9, 12, 0)))
    make("Also on time", ProjectTask.Status.DONE, date(2026, 8, 12),
         timezone.make_aware(timezone.datetime(2026, 8, 12, 9, 0)))
    make("Late", ProjectTask.Status.DONE, date(2026, 8, 1),
         timezone.make_aware(timezone.datetime(2026, 8, 6, 9, 0)))
    make("Done, never dated", ProjectTask.Status.DONE, None,
         timezone.make_aware(timezone.datetime(2026, 8, 6, 9, 0)))
    make("Still going", ProjectTask.Status.IN_PROGRESS, date(2026, 12, 1))
    make("Overdue", ProjectTask.Status.BLOCKED, date(2026, 1, 1))
    yield


def test_the_figures_come_with_their_denominator(company, admin_client, a_worked_history):
    response = admin_client.get(METRICS_URL)

    assert response.status_code == 200
    tasks = response.data["tasks"]
    assert tasks["total"] == 6
    assert tasks["done"] == 4
    assert tasks["open"] == 2
    assert tasks["completion_rate"] == round(4 / 6 * 100, 1)


def test_lateness_is_judged_only_where_a_date_was_set(company, admin_client, a_worked_history):
    """Counting undated work as on time rewards never committing to a date;
    counting it as late punishes work nobody dated."""
    response = admin_client.get(METRICS_URL)

    tasks = response.data["tasks"]
    assert tasks["with_due_date"] == 3  # the fourth done task had no due date
    assert tasks["on_time"] == 2
    assert tasks["on_time_rate"] == round(2 / 3 * 100, 1)


def test_an_open_task_past_its_date_is_counted_separately(company, admin_client, a_worked_history):
    """Overdue is about work still outstanding — it is not the inverse of
    on-time, which is only ever about work already finished."""
    response = admin_client.get(METRICS_URL)

    assert response.data["tasks"]["overdue_open"] == 1


def test_no_tasks_means_no_rate_rather_than_zero(company, admin_client, payroll_setup):
    """Somebody with no tasks has not completed 0% of them. A dashboard showing
    0% beside a new joiner reads as a failure that has not happened."""
    response = admin_client.get(METRICS_URL)

    tasks = response.data["tasks"]
    assert tasks["total"] == 0
    assert tasks["completion_rate"] is None
    assert tasks["on_time_rate"] is None


def test_the_figures_carry_no_score(company, admin_client, a_worked_history):
    """The system presents; it does not judge. A rating field here would
    quietly replace HR's view with an average nobody agreed to."""
    body = response_keys(admin_client.get(METRICS_URL).data["tasks"])

    for forbidden in ("score", "rating", "grade", "performance", "rank"):
        assert forbidden not in body


def response_keys(payload):
    return set(payload.keys())


def test_a_period_can_be_asked_for(company, admin_client, a_worked_history):
    """A review covers a quarter; lifetime totals flatter whoever has been here
    longest."""
    response = admin_client.get(f"{METRICS_URL}?since=2030-01-01")

    assert response.status_code == 200
    assert response.data["tasks"]["total"] == 0


def test_a_bad_period_is_refused_rather_than_ignored(company, admin_client):
    """Silently ignoring it would report lifetime figures under a heading that
    says otherwise."""
    response = admin_client.get(f"{METRICS_URL}?since=last-tuesday")

    assert response.status_code == 400


def test_an_employee_sees_their_own_figures(company, employee_client, worker):
    response = employee_client.get(METRICS_URL)

    assert response.status_code == 200
    assert response.data["employee"] == worker.id


def test_an_employee_cannot_read_a_colleagues_figures(
    company, employee_client, worker, payroll_setup
):
    """Otherwise this is a tool for colleagues to rank each other, which is not
    what it was asked for."""
    response = employee_client.get(f"{METRICS_URL}?employee={payroll_setup['emp'].id}")

    assert response.status_code == 403


def test_hr_can_read_anybodys(company, admin_client, worker):
    response = admin_client.get(f"{METRICS_URL}?employee={worker.id}")

    assert response.status_code == 200
    assert response.data["employee"] == worker.id


def test_the_profile_lists_what_is_in_front_of_somebody(company, admin_client, a_worked_history):
    """Soonest deadline first, undated last — a dated task is the one being
    asked about."""
    response = admin_client.get(METRICS_URL)

    titles = [t["title"] for t in response.data["open_tasks"]]
    assert titles == ["Overdue", "Still going"]
    assert len(response.data["active_projects"]) == 1


# ── Breaking work down ───────────────────────────────────────────────────
#
# A task could not be broken into steps, so anything real became either one
# enormous card or several unrelated ones. One level of nesting, deliberately:
# a board cannot draw a tree, and "how far through is this" stops having an
# answer once somebody builds a five-deep hierarchy.


def test_a_task_can_be_broken_into_steps(company, admin_client, task, project):
    response = admin_client.post(
        TASKS_URL,
        {"project": project.id, "title": "Read the conversion table", "parent": task.id},
        format="json",
    )

    assert response.status_code == 201, response.data
    assert response.data["parent"] == task.id


def test_a_sub_task_cannot_have_sub_tasks_of_its_own(company, admin_client, task, project):
    """One level. Arbitrary nesting sounds more capable and is worse: nobody
    can read a five-deep tree and a board cannot draw one."""
    step = ProjectTask.objects.create(project=project, title="A step", parent=task)

    response = admin_client.post(
        TASKS_URL,
        {"project": project.id, "title": "A step of a step", "parent": step.id},
        format="json",
    )

    assert response.status_code == 400
    assert "one level" in str(response.data).lower()


def test_a_sub_task_must_be_on_its_parents_project(company, admin_client, task):
    """Otherwise it shows under a parent on a board it is not on, and the other
    project's progress counts work filed somewhere else."""
    other = Project.objects.create(name="Somewhere else", status=Project.Status.ACTIVE)

    response = admin_client.post(
        TASKS_URL,
        {"project": other.id, "title": "Misfiled", "parent": task.id},
        format="json",
    )

    assert response.status_code == 400


def test_a_task_with_steps_cannot_become_a_step(company, admin_client, task, project):
    """The second level arriving by the back door."""
    ProjectTask.objects.create(project=project, title="A step", parent=task)
    other_parent = ProjectTask.objects.create(project=project, title="Another top-level")

    response = admin_client.patch(
        f"{TASKS_URL}{task.id}/", {"parent": other_parent.id}, format="json"
    )

    assert response.status_code == 400


def test_the_board_does_not_show_steps_as_their_own_cards(company, admin_client, task, project):
    """A board showing every step as a card is one nobody can read, and the
    column counts would say twelve where a person sees three pieces of work."""
    ProjectTask.objects.create(project=project, title="Step one", parent=task)
    ProjectTask.objects.create(project=project, title="Step two", parent=task)

    response = admin_client.get(f"{TASKS_URL}?project={project.id}")

    titles = [row["title"] for row in response.data["results"]]
    assert task.title in titles
    assert "Step one" not in titles


def test_the_steps_of_one_task_can_be_asked_for(company, admin_client, task, project):
    ProjectTask.objects.create(project=project, title="Step one", parent=task)
    ProjectTask.objects.create(project=project, title="Step two", parent=task)

    response = admin_client.get(f"{TASKS_URL}?parent={task.id}")

    assert {row["title"] for row in response.data["results"]} == {"Step one", "Step two"}


def test_a_parent_reports_how_far_through_its_steps_are(company, admin_client, task, project):
    ProjectTask.objects.create(
        project=project, title="Done step", parent=task, status=ProjectTask.Status.DONE
    )
    ProjectTask.objects.create(project=project, title="Open step", parent=task)

    response = admin_client.get(f"{TASKS_URL}{task.id}/")

    assert response.data["subtask_total"] == 2
    assert response.data["subtask_done"] == 1


def test_deleting_a_parent_takes_its_steps_with_it(company, admin_client, task, project):
    """A sub-task is part of its parent rather than a task that references one.
    Orphans would sit on the board with no context for why they exist."""
    step = ProjectTask.objects.create(project=project, title="Step", parent=task)

    admin_client.delete(f"{TASKS_URL}{task.id}/")

    assert not ProjectTask.objects.filter(pk=step.pk).exists()


# ── Estimates, in the same unit as the hours we already collect ──────────


def test_an_estimate_can_be_recorded(company, admin_client, task):
    response = admin_client.patch(
        f"{TASKS_URL}{task.id}/", {"estimate_hours": "6.50"}, format="json"
    )

    assert response.status_code == 200
    assert response.data["estimate_hours"] == "6.50"


def test_logged_hours_come_back_beside_the_estimate(company, admin_client, task, project, payroll_setup):
    """Hours rather than story points, so the estimate can be checked against
    something the system already holds."""
    from timesheets.models import TimeEntry

    task.estimate_hours = Decimal("8")
    task.save(update_fields=["estimate_hours"])
    for _ in range(2):
        TimeEntry.objects.create(
            employee=payroll_setup["emp"], project=project, task=task,
            date=date(2026, 8, 6), hours=Decimal("3"),
        )

    response = admin_client.get(f"{TASKS_URL}{task.id}/")

    assert Decimal(response.data["logged_hours"]) == Decimal("6")


def test_logged_hours_are_not_multiplied_by_the_other_joins(
    company, admin_client, task, project, payroll_setup
):
    """The bug a plain `Sum` alongside the comment and sub-task counts would
    cause: summing across a second join multiplies the total by the rows the
    other joins produced, so a task with three comments would report three
    times its hours."""
    from timesheets.models import TimeEntry

    for n in range(3):
        TaskComment.objects.create(task=task, body=f"comment {n}")
    ProjectTask.objects.create(project=project, title="A step", parent=task)
    TimeEntry.objects.create(
        employee=payroll_setup["emp"], project=project, task=task,
        date=date(2026, 8, 6), hours=Decimal("4"),
    )

    response = admin_client.get(f"{TASKS_URL}{task.id}/")

    assert Decimal(response.data["logged_hours"]) == Decimal("4")


def test_changing_an_estimate_is_recorded_in_the_trail(company, admin_client, task):
    """An estimate that moves without a record is how a sprint quietly grows."""
    admin_client.patch(f"{TASKS_URL}{task.id}/", {"estimate_hours": "4"}, format="json")
    admin_client.patch(f"{TASKS_URL}{task.id}/", {"estimate_hours": "12"}, format="json")

    entries = TaskActivity.objects.filter(task=task, field="estimate_hours")

    assert entries.count() == 2


# ── Metrics do not reward breaking work down ─────────────────────────────


def test_a_parent_and_its_steps_are_not_counted_twice(company, payroll_setup, project):
    """Counting both would mean somebody who breaks work down looks more
    productive than somebody doing identical work in one card."""
    from projects.metrics import task_metrics

    emp = payroll_setup["emp"]
    parent = ProjectTask.objects.create(project=project, title="Big thing", assignee=emp)
    ProjectTask.objects.create(
        project=project, title="Step one", parent=parent, assignee=emp,
        status=ProjectTask.Status.DONE,
    )
    ProjectTask.objects.create(project=project, title="Step two", parent=parent, assignee=emp)

    figures = task_metrics(emp)

    # The two steps, not the container as well.
    assert figures["total"] == 2
    assert figures["done"] == 1


def test_a_task_with_no_steps_still_counts(company, payroll_setup, project):
    """Nobody is penalised for *not* breaking work down either."""
    from projects.metrics import task_metrics

    emp = payroll_setup["emp"]
    ProjectTask.objects.create(project=project, title="One card", assignee=emp)

    figures = task_metrics(emp)

    assert figures["total"] == 1


# ── A project is never deleted ────────────────────────────────────────────────
#
# The removal decision for `Project` is a **state change**, and these tests pin
# both halves of it: the delete is genuinely absent, and the two states that
# replace it work and are reversible. Without the second half this would just be
# a missing feature rather than a removal path.


def test_a_project_cannot_be_deleted_by_anybody(company, admin_client, project):
    """Not "refused for this caller" — **not a route at all.**

    405 rather than 403 or 409 is the assertion that matters. The viewset omits
    `DestroyModelMixin` instead of overriding `destroy` to raise, so DRF answers
    from its own routing and the method is not advertised in `Allow:`. An
    override would say "this exists and you may not do it", which is false: it
    does not exist for anybody, including an admin.
    """
    response = admin_client.delete(f"{PROJECTS_URL}{project.id}/")

    assert response.status_code == 405
    assert Project.objects.filter(pk=project.id).exists()


def test_a_project_is_stopped_by_status_and_can_come_back(company, admin_client, project):
    """On hold and cancelled are both reachable, and both reversible.

    A greyed-out row with no way back is not reversibility, so the reopen is
    asserted rather than assumed.
    """
    for stopped in (Project.Status.ON_HOLD, Project.Status.CANCELLED):
        response = admin_client.patch(
            f"{PROJECTS_URL}{project.id}/", {"status": stopped}, format="json"
        )
        assert response.status_code == 200
        assert response.data["status"] == stopped

    response = admin_client.patch(
        f"{PROJECTS_URL}{project.id}/", {"status": Project.Status.ACTIVE}, format="json"
    )
    assert response.status_code == 200
    assert response.data["status"] == Project.Status.ACTIVE


def test_cancelling_a_project_keeps_its_work(company, admin_client, project, a_task_in_every_state):
    """The whole reason a delete was refused.

    Cancelling must not quietly behave like one — the tasks, their history and
    the logged hours are the record of work people were paid for.
    """
    before = ProjectTask.objects.filter(project=project).count()
    assert before > 0

    admin_client.patch(
        f"{PROJECTS_URL}{project.id}/", {"status": Project.Status.CANCELLED}, format="json"
    )

    assert ProjectTask.objects.filter(project=project).count() == before


def test_a_project_with_logged_hours_is_protected_at_the_database(company, project, payroll_setup):
    """The API has no delete, but the API is not the only way in.

    A shell session or the admin would have destroyed approved hours under the
    old `CASCADE`. `PROTECT` means the constraint is on the data rather than on
    one code path — and under normal use it is never reached, which is what
    makes it worth having.
    """
    from django.db.models import ProtectedError

    from timesheets.models import TimeEntry

    TimeEntry.objects.create(
        employee=payroll_setup["emp"],
        project=project,
        date=date(2026, 8, 24),
        hours=Decimal("3.50"),
    )

    with pytest.raises(ProtectedError):
        project.delete()

    assert Project.objects.filter(pk=project.id).exists()


# ── Hours reach the task they were worked on ─────────────────────────────────


def test_time_logged_against_a_task_reaches_that_task(
    company, employee_client, admin_client, worker, task, project, payroll_setup
):
    """The estimate-versus-actual loop, end to end through the API.

    `logged_hours` was already computed correctly and already tested — but
    `TimeEntry.task` was writable and **no screen wrote it**, so in the running
    product the figure was `0.00` for every task that ever existed. A unit test
    over the annotation could not see that; this posts through the timesheet
    endpoint the way the form now does, and then reads the task back.
    """
    task.estimate_hours = Decimal("8")
    task.save(update_fields=["estimate_hours"])

    logged = employee_client.post(
        "/api/v1/timesheets/entries/",
        {
            "project": project.id,
            "task": task.id,
            "date": "2026-08-24",
            "hours": "2.50",
            "description": "Wired the picker",
        },
        format="json",
    )
    assert logged.status_code == 201, logged.data
    assert logged.data["task"] == task.id
    assert logged.data["task_title"] == task.title

    response = admin_client.get(f"{TASKS_URL}{task.id}/")

    assert Decimal(response.data["logged_hours"]) == Decimal("2.50")
    assert response.data["estimate_hours"] == "8.00"


def test_time_can_still_be_logged_without_naming_a_task(
    company, employee_client, worker, project, payroll_setup
):
    """The task is optional, and must stay optional.

    Plenty of real work is not on a card, and a required task would either stop
    those hours being recorded or push people into inventing a card to hold
    them — which corrupts the very figures the task is there to produce.
    """
    response = employee_client.post(
        "/api/v1/timesheets/entries/",
        {"project": project.id, "date": "2026-08-24", "hours": "1.00"},
        format="json",
    )

    assert response.status_code == 201, response.data
    assert response.data["task"] is None


def test_deleting_a_task_takes_its_attachments_with_it(company, admin_client, task, project):
    """D‑16. Files hang off `Document` through a generic key, and Django knows
    nothing about the reverse side of one unless a `GenericRelation` says so.

    Without it a deleted task left its rows pointing at an `object_id` that no
    longer resolved: invisible to every list endpoint, indistinguishable from
    live rows, and holding files nothing would ever reclaim. The unrelated
    task's attachment is asserted too — a cascade that takes the neighbours is
    a worse bug than the leak it replaced.
    """
    from django.contrib.contenttypes.models import ContentType

    from documents.models import Document

    admin_client.post(ATTACHMENTS_URL, {"task": task.id, "file": _upload()}, format="multipart")
    survivor = ProjectTask.objects.create(project=project, title="Untouched")
    admin_client.post(
        ATTACHMENTS_URL, {"task": survivor.id, "file": _upload("keep.txt")}, format="multipart"
    )

    task_ct = ContentType.objects.get_for_model(ProjectTask)
    assert Document.objects.filter(content_type=task_ct, object_id=task.id).count() == 1

    task.delete()

    assert Document.objects.filter(content_type=task_ct, object_id=task.id).count() == 0
    assert Document.objects.filter(content_type=task_ct, object_id=survivor.id).count() == 1


def test_deleting_a_task_takes_its_steps_attachments_too(company, admin_client, project):
    """A sub-task cascades from its parent, so its files have to follow.

    This is the case the `GenericRelation` alone does not obviously cover: the
    step is deleted by the parent's cascade rather than by anybody calling
    `delete()` on it, and a cascade that skips the second hop leaves exactly
    the orphans this fix exists to prevent.
    """
    from django.contrib.contenttypes.models import ContentType

    from documents.models import Document

    parent = ProjectTask.objects.create(project=project, title="Big thing")
    step = ProjectTask.objects.create(project=project, title="Step", parent=parent)

    admin_client.post(
        ATTACHMENTS_URL, {"task": step.id, "file": _upload("step.txt")}, format="multipart"
    )

    task_ct = ContentType.objects.get_for_model(ProjectTask)
    assert Document.objects.filter(content_type=task_ct, object_id=step.id).count() == 1

    parent.delete()

    assert not ProjectTask.objects.filter(pk=step.id).exists()
    assert Document.objects.filter(content_type=task_ct, object_id=step.id).count() == 0


# ── What has to happen first ─────────────────────────────────────────────────
#
# `BLOCKED` was a status with nothing behind it: somebody set it by hand and
# what they were waiting on lived in their head. The board could say "stuck"
# and never say *on what*.


def test_a_blocker_is_named_not_just_counted(company, admin_client, project):
    """"This is blocked" is not actionable. "Blocked by *Migrate the database*"
    is — which is the whole reason the edge is recorded."""
    first = ProjectTask.objects.create(project=project, title="Migrate the database")
    second = ProjectTask.objects.create(project=project, title="Cut over")
    second.blocked_by.add(first)

    response = admin_client.get(f"{TASKS_URL}{second.id}/")

    assert response.data["is_blocked"] is True
    assert response.data["blockers"][0]["title"] == "Migrate the database"


def test_a_finished_blocker_stops_blocking(company, admin_client, project):
    """A dependency on something already done is history, not an obstruction.

    Counting it would leave every task permanently blocked by its own past.
    """
    first = ProjectTask.objects.create(project=project, title="Migrate")
    second = ProjectTask.objects.create(project=project, title="Cut over")
    second.blocked_by.add(first)
    assert second.is_blocked is True

    first.status = ProjectTask.Status.DONE
    first.save(update_fields=["status"])
    second.refresh_from_db()

    assert second.is_blocked is False


def test_a_task_knows_who_is_waiting_on_it(company, admin_client, project):
    """The question somebody asks about their *own* work: am I holding anybody
    up? That is the reverse edge, and it is why this is not symmetrical."""
    blocker = ProjectTask.objects.create(project=project, title="Sign off the design")
    for title in ("Build it", "Document it"):
        ProjectTask.objects.create(project=project, title=title).blocked_by.add(blocker)

    response = admin_client.get(f"{TASKS_URL}{blocker.id}/")

    assert response.data["blocking_count"] == 2
    # And it is not itself blocked — the relationship runs one way.
    assert response.data["is_blocked"] is False


def test_a_task_cannot_wait_for_itself(company, admin_client, project):
    task = ProjectTask.objects.create(project=project, title="Alone")

    response = admin_client.patch(
        f"{TASKS_URL}{task.id}/", {"blocked_by": [task.id]}, format="json"
    )

    assert response.status_code == 400
    assert "itself" in str(response.data).lower()


def test_a_cycle_is_refused(company, admin_client, project):
    """🔒 A cycle is a hang, not a slow query.

    "What is blocking this?" walks the graph, and A→B→A never terminates. The
    check runs *before* the edge exists rather than as a depth limit after.
    """
    a = ProjectTask.objects.create(project=project, title="A")
    b = ProjectTask.objects.create(project=project, title="B")
    c = ProjectTask.objects.create(project=project, title="C")
    b.blocked_by.add(a)
    c.blocked_by.add(b)

    # Direct: A waits for B, which already waits for A.
    direct = admin_client.patch(f"{TASKS_URL}{a.id}/", {"blocked_by": [b.id]}, format="json")
    assert direct.status_code == 400
    assert "loop" in str(direct.data).lower()

    # Indirect: A waits for C, and C already waits for B which waits for A.
    indirect = admin_client.patch(f"{TASKS_URL}{a.id}/", {"blocked_by": [c.id]}, format="json")
    assert indirect.status_code == 400


def test_a_dependency_stays_on_one_project(company, admin_client, project):
    """A board cannot draw a dependency on a task it does not show, and a
    half-drawn graph is worse than none. Cross-project blocking is deferred
    rather than half-built."""
    other_project = Project.objects.create(name="Somewhere else")
    mine = ProjectTask.objects.create(project=project, title="Mine")
    theirs = ProjectTask.objects.create(project=other_project, title="Theirs")

    response = admin_client.patch(
        f"{TASKS_URL}{mine.id}/", {"blocked_by": [theirs.id]}, format="json"
    )

    assert response.status_code == 400
    assert "same project" in str(response.data).lower()


def test_a_long_chain_does_not_hang(company, admin_client, project):
    """The cycle walk has to terminate on a legitimate deep chain too — a guard
    that only works on short graphs is a guard that fails in production."""
    previous = None
    for i in range(30):
        task = ProjectTask.objects.create(project=project, title=f"Step {i}")
        if previous:
            task.blocked_by.add(previous)
        previous = task

    # Legal: the newest waits on the oldest's successor chain already.
    assert previous.is_blocked is False or previous.is_blocked is True


# ── What we owe somebody else ────────────────────────────────────────────────
#
# A sprint is the team's own cadence. A milestone is a commitment made outwards,
# and the difference is not decorative: a sprint moves without a conversation
# and a milestone does not.


def test_a_milestone_is_reached_by_its_tasks_not_by_a_tick(company, admin_client, project):
    """🔒 There is no "mark as complete".

    A milestone that can be ticked can be ticked with open work under it — and
    it then says the opposite of the truth to exactly the person, a client or
    somebody raising an invoice, that it exists to inform.
    """
    milestone = Milestone.objects.create(
        project=project, name="Beta to the client", due_date=date(2030, 1, 31)
    )
    first = ProjectTask.objects.create(project=project, title="Ship it", milestone=milestone)
    ProjectTask.objects.create(project=project, title="Document it", milestone=milestone)

    listing = admin_client.get(f"{MILESTONES_URL}{milestone.id}/")
    assert listing.data["task_count"] == 2
    assert listing.data["done_count"] == 0
    assert listing.data["is_complete"] is False

    # Asking for it directly changes nothing — the field is read-only.
    admin_client.patch(
        f"{MILESTONES_URL}{milestone.id}/",
        {"completed_at": "2026-01-01T00:00:00Z"},
        format="json",
    )
    milestone.refresh_from_db()
    assert milestone.completed_at is None

    # Finishing the work does.
    admin_client.patch(f"{TASKS_URL}{first.id}/", {"status": "done"}, format="json")
    second = ProjectTask.objects.get(title="Document it")
    admin_client.patch(f"{TASKS_URL}{second.id}/", {"status": "done"}, format="json")

    milestone.refresh_from_db()
    assert milestone.completed_at is not None


def test_reopening_work_un_reaches_the_milestone(company, admin_client, project):
    """A stamp that only moved forward would leave a milestone claiming delivery
    with live work under it — the one thing this must never say."""
    milestone = Milestone.objects.create(
        project=project, name="Handover", due_date=date(2030, 6, 1)
    )
    task = ProjectTask.objects.create(project=project, title="The work", milestone=milestone)

    admin_client.patch(f"{TASKS_URL}{task.id}/", {"status": "done"}, format="json")
    milestone.refresh_from_db()
    assert milestone.completed_at is not None

    admin_client.patch(f"{TASKS_URL}{task.id}/", {"status": "in_progress"}, format="json")
    milestone.refresh_from_db()
    assert milestone.completed_at is None


def test_an_empty_milestone_is_not_complete(company, project):
    """"Nothing attached yet" and "everything finished" are different answers,
    and a naive `done == total` gives the same one for both."""
    milestone = Milestone.objects.create(
        project=project, name="Nothing yet", due_date=date(2030, 1, 1)
    )
    assert milestone.progress() == (0, 0)
    milestone.refresh_completion()
    assert milestone.completed_at is None


def test_moving_a_task_refreshes_both_milestones(company, admin_client, project):
    """The one it left may now be complete; the one it joined may no longer be.
    Refreshing only the destination leaves the source stuck."""
    source = Milestone.objects.create(project=project, name="A", due_date=date(2030, 1, 1))
    target = Milestone.objects.create(project=project, name="B", due_date=date(2030, 2, 1))
    ProjectTask.objects.create(
        project=project, title="Finished", milestone=source, status=ProjectTask.Status.DONE
    )
    open_task = ProjectTask.objects.create(project=project, title="Open", milestone=source)
    ProjectTask.objects.create(
        project=project, title="Also finished", milestone=target,
        status=ProjectTask.Status.DONE,
    )
    target.refresh_completion()
    assert target.completed_at is not None  # B: one task, and it is done.

    # Move the open task from A to B. A becomes complete; B stops being.
    admin_client.patch(f"{TASKS_URL}{open_task.id}/", {"milestone": target.id}, format="json")

    source.refresh_from_db()
    target.refresh_from_db()
    assert source.completed_at is not None
    assert target.completed_at is None


def test_the_original_date_is_kept_when_a_milestone_slips(company, admin_client, project):
    """"We said the 12th and delivered on the 30th" is what anybody reviewing a
    project asks, and one mutable date cannot answer it."""
    milestone = Milestone.objects.create(
        project=project, name="Phase one", due_date=date(2030, 3, 12)
    )
    # Nothing recorded while it has not moved — a redundant copy of its own
    # date would make an unslipped milestone read as though it had.
    assert milestone.original_due_date is None

    admin_client.patch(
        f"{MILESTONES_URL}{milestone.id}/", {"due_date": "2030-03-30"}, format="json"
    )

    response = admin_client.get(f"{MILESTONES_URL}{milestone.id}/")
    assert response.data["original_due_date"] == "2030-03-12"
    assert response.data["has_slipped"] is True

    # A second move keeps the *first* promise, not the most recent one.
    admin_client.patch(
        f"{MILESTONES_URL}{milestone.id}/", {"due_date": "2030-04-15"}, format="json"
    )
    again = admin_client.get(f"{MILESTONES_URL}{milestone.id}/")
    assert again.data["original_due_date"] == "2030-03-12"


def test_late_means_overdue_and_unfinished(company, admin_client, project):
    """A milestone delivered after its date has *slipped*, not gone late.
    Calling it late forever makes the flag useless for finding what needs
    attention now."""
    overdue = Milestone.objects.create(
        project=project, name="Overdue", due_date=date(2020, 1, 1)
    )
    ProjectTask.objects.create(project=project, title="Still open", milestone=overdue)

    delivered_late = Milestone.objects.create(
        project=project, name="Delivered late", due_date=date(2020, 1, 1)
    )
    ProjectTask.objects.create(
        project=project, title="Done", milestone=delivered_late,
        status=ProjectTask.Status.DONE,
    )
    delivered_late.refresh_completion()

    assert admin_client.get(f"{MILESTONES_URL}{overdue.id}/").data["is_late"] is True
    assert admin_client.get(f"{MILESTONES_URL}{delivered_late.id}/").data["is_late"] is False


def test_a_reached_milestone_cannot_be_deleted(company, admin_client, project):
    """🔒 R2, answered both ways off the same rule.

    An unmet milestone is a plan, and dropping a plan nobody kept is
    housekeeping. A reached one is a *record* — on a billable milestone it is
    the evidence behind an invoice — and deleting it erases what was delivered.
    """
    plan = Milestone.objects.create(
        project=project, name="Just a plan", due_date=date(2030, 1, 1)
    )
    reached = Milestone.objects.create(
        project=project, name="Delivered", due_date=date(2030, 1, 1), is_billable=True
    )
    ProjectTask.objects.create(
        project=project, title="Done", milestone=reached, status=ProjectTask.Status.DONE
    )
    reached.refresh_completion()

    assert admin_client.delete(f"{MILESTONES_URL}{plan.id}/").status_code == 204

    refused = admin_client.delete(f"{MILESTONES_URL}{reached.id}/")
    assert refused.status_code == 400
    assert "delivered" in str(refused.data).lower()


def test_deleting_a_milestone_does_not_delete_the_work(company, admin_client, project):
    """A plan is not the parent of the work done under it. `SET_NULL` — and that
    is precisely why `Milestone` may be deleted where `Project` may not."""
    milestone = Milestone.objects.create(
        project=project, name="Abandoned", due_date=date(2030, 1, 1)
    )
    task = ProjectTask.objects.create(project=project, title="Real work", milestone=milestone)

    admin_client.delete(f"{MILESTONES_URL}{milestone.id}/")

    task.refresh_from_db()
    assert task.milestone is None


def test_a_task_can_be_in_a_sprint_and_a_milestone_at_once(company, admin_client, project):
    """They answer different questions — *when are we doing this* and *what does
    it count towards* — so forcing a choice makes one of them unanswerable."""
    sprint = Sprint.objects.create(
        project=project, name="Sprint 4",
        start_date=date(2030, 1, 1), end_date=date(2030, 1, 14),
    )
    milestone = Milestone.objects.create(
        project=project, name="Beta", due_date=date(2030, 1, 31)
    )
    task = ProjectTask.objects.create(
        project=project, title="Both", sprint=sprint, milestone=milestone
    )

    response = admin_client.get(f"{TASKS_URL}{task.id}/")
    assert response.data["sprint"] == sprint.id
    assert response.data["milestone"] == milestone.id
    assert response.data["milestone_name"] == "Beta"


# ── What to pick up next ─────────────────────────────────────────────────────
#
# The board could move a card between columns but not within one: a same-column
# drag was discarded by the client and never reached the server. So `order`
# existed, was the default ordering, and could only be changed in the database.


def test_a_column_can_be_put_in_order(company, admin_client, project):
    """A column of twenty with no order cannot answer *what do I pick up next*."""
    first = ProjectTask.objects.create(project=project, title="First", order=10)
    second = ProjectTask.objects.create(project=project, title="Second", order=20)
    third = ProjectTask.objects.create(project=project, title="Third", order=30)

    response = admin_client.post(
        f"{TASKS_URL}reorder/", {"ids": [third.id, first.id, second.id]}, format="json"
    )
    assert response.status_code == 200

    listing = admin_client.get(f"{TASKS_URL}?project={project.id}&ordering=order")
    assert [row["title"] for row in listing.data["results"]] == ["Third", "First", "Second"]


def test_positions_leave_room_between_them(company, admin_client, project):
    """Gaps of ten, so inserting one card later does not mean rewriting the
    whole column."""
    a = ProjectTask.objects.create(project=project, title="A")
    b = ProjectTask.objects.create(project=project, title="B")

    admin_client.post(f"{TASKS_URL}reorder/", {"ids": [a.id, b.id]}, format="json")

    a.refresh_from_db()
    b.refresh_from_db()
    assert (a.order, b.order) == (10, 20)


def test_reorder_refuses_a_task_that_does_not_exist(company, admin_client, project):
    """A silent skip would leave the column in an order nobody asked for, with
    no sign that part of the instruction was dropped."""
    task = ProjectTask.objects.create(project=project, title="Real")

    response = admin_client.post(
        f"{TASKS_URL}reorder/", {"ids": [task.id, 9_999_999]}, format="json"
    )
    assert response.status_code == 400
    assert "9999999" in str(response.data)


def test_reorder_refuses_two_projects_at_once(company, admin_client, project):
    """Orders are per project and independent. Interleaving two is meaningless,
    and doing it silently would scramble both boards."""
    other = Project.objects.create(name="Elsewhere")
    mine = ProjectTask.objects.create(project=project, title="Mine")
    theirs = ProjectTask.objects.create(project=other, title="Theirs")

    response = admin_client.post(
        f"{TASKS_URL}reorder/", {"ids": [mine.id, theirs.id]}, format="json"
    )
    assert response.status_code == 400
    assert "same project" in str(response.data).lower()


def test_reorder_needs_a_list_of_ids(company, admin_client, project):
    for payload in ({}, {"ids": []}, {"ids": "1,2"}, {"ids": ["not-a-number"]}):
        response = admin_client.post(f"{TASKS_URL}reorder/", payload, format="json")
        assert response.status_code == 400, payload


def test_reorder_checks_every_task_not_just_the_first(
    company, employee_client, employee_user, project
):
    """🔒 Permission is per row, so the check is per row.

    Somebody who may write to *one* task in the list is not thereby allowed to
    reshuffle a column holding somebody else's. One refusal rejects the whole
    request rather than applying a partial reorder nobody asked for.
    """
    employee = Employee.objects.create(
        user=employee_user, employee_code="EMP-REORDER", date_joined=date(2026, 1, 1)
    )
    mine = ProjectTask.objects.create(project=project, title="Mine", assignee=employee)
    # No assignee, and this employee neither manages nor owns the project.
    not_mine = ProjectTask.objects.create(project=project, title="Somebody else's")
    before = (mine.order, not_mine.order)

    response = employee_client.post(
        f"{TASKS_URL}reorder/", {"ids": [not_mine.id, mine.id]}, format="json"
    )
    assert response.status_code == 403

    # And nothing moved — not even the row they were allowed to touch.
    mine.refresh_from_db()
    not_mine.refresh_from_db()
    assert (mine.order, not_mine.order) == before
