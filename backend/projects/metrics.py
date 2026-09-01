"""What one person's project work looks like, as numbers.

**D22, settled 25 August: these are project figures, not a performance score.**
The question raised was whether they should feed a company-wide performance
rubric. They should not — Projects is one module of thirty-five, and a payroll
officer's work appears in it nowhere, so measured company-wide these would
systematically favour whoever happens to work in projects.

So they stay exactly what they are: **the Projects & Tasks section of somebody's
profile**, answering "what am I involved in, and how is it going". Rich, complete
and informational — and never rolled into a number that stands for the person.


**This module deliberately reaches no conclusion.** It returns counts, rates and
durations; it does not score anybody, rank anybody, or decide whether a figure
is good. HR and the owner read these and form their own view — that is the
whole arrangement, and a "performance: 72%" field would quietly replace their
judgement with an average nobody agreed to.

Which is not only a policy preference. Every number here has a reading that
depends on context the system does not hold. A low completion rate is a person
who was moved onto something urgent halfway through the quarter. A long cycle
time is a task that was correctly blocked on a client for three weeks. A high
count of small tasks is not more work than a low count of large ones. So each
figure is reported **with its denominator and its exclusions stated**, and the
interpretation is left to somebody who knows what happened.

**Why cycle time is measured from creation and not from first touch.** The
alternative needs a "started at" nobody reliably sets, and inferring it from
the first move out of *To do* would mean a task nobody dragged has no cycle
time at all. Creation-to-completion is coarser and honest about what it is: how
long the request was outstanding, not how long the work took.
"""

from datetime import date
from decimal import Decimal

from django.db.models import Case, Count, F, IntegerField, Q, When

from projects.models import Project, ProjectTask

#: Priority, ranked. `-priority` cannot do this: the column holds
#: low/normal/high/urgent as text, so descending alphabetical order is urgent,
#: normal, low, high — which puts the least important above the second most.
PRIORITY_ORDER = Case(
    When(priority=ProjectTask.Priority.URGENT, then=0),
    When(priority=ProjectTask.Priority.HIGH, then=1),
    When(priority=ProjectTask.Priority.NORMAL, then=2),
    When(priority=ProjectTask.Priority.LOW, then=3),
    default=2,
    output_field=IntegerField(),
)


def _rate(part: int, whole: int) -> float | None:
    """A percentage, or `None` when there is nothing to divide by.

    Zero would be a lie here: somebody with no tasks has not completed 0% of
    them, they have no rate at all, and a dashboard showing 0% next to a new
    joiner reads as a failure that has not happened.
    """
    if whole == 0:
        return None
    return round(part / whole * 100, 1)


def task_metrics(employee, since=None):
    """Everything countable about one person's tasks.

    `since` optionally narrows to tasks created on or after a date — a review
    covers a period, and lifetime totals flatter whoever has been here longest.
    """
    # **Leaf tasks only.** A parent that has been broken into steps is a
    # container, and counting it alongside its own sub-tasks counts the same
    # work twice — which would mean somebody who breaks work down looks more
    # productive than somebody who does the identical work in one card. This
    # module exists to avoid exactly that kind of accidental judgement.
    #
    # A task with no sub-tasks is itself a leaf and counts normally, so nobody
    # is penalised for *not* breaking work down either.
    tasks = ProjectTask.objects.filter(assignee=employee).filter(subtasks__isnull=True)
    if since is not None:
        tasks = tasks.filter(created_at__date__gte=since)

    by_status = dict(
        tasks.values_list("status").annotate(n=Count("id")).values_list("status", "n")
    )
    total = sum(by_status.values())
    done = by_status.get(ProjectTask.Status.DONE, 0)
    open_count = total - done

    completed = tasks.filter(
        status=ProjectTask.Status.DONE, completed_at__isnull=False
    ).values_list("created_at", "completed_at", "due_date")

    durations = [(finished - created).days for created, finished, _ in completed]

    # On time is judged only where a due date was set. Counting undated tasks as
    # on time would reward never committing to one, and counting them as late
    # would punish work nobody put a date on.
    dated = [(finished, due) for _, finished, due in completed if due is not None]
    on_time = sum(1 for finished, due in dated if finished.date() <= due)

    today = date.today()
    overdue = tasks.exclude(status=ProjectTask.Status.DONE).filter(
        due_date__isnull=False, due_date__lt=today
    ).count()

    # ── Time, now that there is any ──────────────────────────────────────
    #
    # These could not exist until estimates were in hours and hours could be
    # booked against a task. They are the "how long did it take" half of the
    # picture, and the only figures here that compare a plan to a reality.
    from django.db.models import Sum

    from timesheets.models import TimeEntry

    estimated = tasks.aggregate(total=Sum("estimate_hours"))["total"] or Decimal("0")
    logged = TimeEntry.objects.filter(task__in=tasks).aggregate(
        total=Sum("hours")
    )["total"] or Decimal("0")

    #: Only tasks carrying **both** an estimate and logged time can be compared.
    #: Measuring accuracy across tasks nobody estimated would report a wild
    #: overrun for work that was never planned, which says nothing about
    #: anybody.
    comparable = tasks.filter(estimate_hours__isnull=False, time_entries__isnull=False).distinct()
    comparable_estimate = comparable.aggregate(total=Sum("estimate_hours"))["total"] or Decimal("0")
    comparable_logged = TimeEntry.objects.filter(task__in=comparable).aggregate(
        total=Sum("hours")
    )["total"] or Decimal("0")

    return {
        "total": total,
        "done": done,
        "open": open_count,
        #: Hours planned across their tasks, and hours actually booked.
        "hours_estimated": estimated,
        "hours_logged": logged,
        #: Estimated hours as a percentage of actual, over the tasks where both
        #: exist. 100 means the estimates held; 50 means work took twice as long
        #: as planned. Reported with its denominator, like every rate here.
        "estimate_accuracy": _rate(comparable_estimate, comparable_logged),
        "comparable_tasks": comparable.count(),
        "by_status": {choice: by_status.get(choice, 0) for choice, _ in ProjectTask.Status.choices},
        "completion_rate": _rate(done, total),
        #: Days from creation to completion. The median, not the mean — one
        #: task parked for eight months drags an average somewhere no
        #: individual task ever was.
        "median_days_to_complete": _median(durations),
        "on_time": on_time,
        #: The denominator, stated. "8 on time" means nothing without knowing
        #: whether that was out of 9 or out of 40.
        "with_due_date": len(dated),
        "on_time_rate": _rate(on_time, len(dated)),
        "overdue_open": overdue,
    }


def _median(values):
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return round((ordered[middle - 1] + ordered[middle]) / 2, 1)


def project_metrics(employee):
    """Projects this person owns, and the ones they have work on.

    Two numbers rather than one because they describe different things: owning
    six projects is a workload statement, having tasks across six is a
    fragmentation statement, and adding them together says neither.
    """
    owned = Project.objects.filter(owner=employee)
    contributing = Project.objects.filter(tasks__assignee=employee).distinct()

    active = (Project.Status.PLANNING, Project.Status.ACTIVE)
    return {
        "owned": owned.count(),
        "owned_active": owned.filter(status__in=active).count(),
        "contributing": contributing.count(),
        "contributing_active": contributing.filter(status__in=active).count(),
    }


def employee_project_summary(employee, since=None):
    """The whole picture for a profile page: metrics, plus what is live now.

    The lists are capped and ordered by due date. A profile is a summary — it
    shows what is in front of somebody, and links onward to the board for the
    rest.
    """
    open_tasks = (
        ProjectTask.objects.filter(assignee=employee)
        .exclude(status=ProjectTask.Status.DONE)
        .select_related("project")
        .annotate(urgency=PRIORITY_ORDER)
        # Soonest deadline first, undated last — a task with a date is the one
        # being asked about. Priority breaks ties within the same day.
        .order_by(F("due_date").asc(nulls_last=True), "urgency")[:10]
    )

    active_projects = (
        Project.objects.filter(
            Q(owner=employee) | Q(tasks__assignee=employee),
            status__in=(Project.Status.PLANNING, Project.Status.ACTIVE),
        )
        .distinct()
        .annotate(
            task_count=Count("tasks", distinct=True),
            done_count=Count(
                "tasks", filter=Q(tasks__status=ProjectTask.Status.DONE), distinct=True
            ),
        )[:10]
    )

    return {
        "tasks": task_metrics(employee, since=since),
        "projects": project_metrics(employee),
        "open_tasks": open_tasks,
        "active_projects": active_projects,
    }
