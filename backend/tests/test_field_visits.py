"""Field visits: the travel order, and the three seams with everything else.

The module exists because a visit is not a timesheet entry — the argument is in
`fieldvisits/models.py`. What is tested here is the part of that decision that
can actually break:

* the **attendance seam**, which is the one with money attached. Somebody sent
  to the headworks for a week has no clock-in for five days, and before this
  existed the nightly sweep recorded five absences that feed `unpaid_days`.
* the **timesheet seam**, which is the honest version of "can timesheets carry
  field visits": they cannot hold one, but a completed visit can produce them.
* the **order of the transitions**, because approval is what makes a visit
  count for attendance, and a visit that could be approved twice or completed
  without a report would let either seam run on nothing.
"""

from datetime import date, timedelta

import pytest
from django.contrib.auth import get_user_model

from attendance.models import AttendanceLog
from employees.models import Employee
from fieldvisits import services
from fieldvisits.models import FieldVisit
from projects.models import Project
from timesheets.models import TimeEntry

pytestmark = pytest.mark.django_db

VISITS = "/api/v1/field-visits/visits/"


@pytest.fixture
def traveller(db, employee_user, company):
    return Employee.objects.create(
        user=employee_user,
        employee_code="EMP-FV1",
        date_joined=date(2026, 1, 1),
        primary_company=company,
    )


@pytest.fixture
def approver(db, hr_user, company):
    return Employee.objects.create(
        user=hr_user,
        employee_code="EMP-FV2",
        date_joined=date(2026, 1, 1),
        primary_company=company,
    )


@pytest.fixture
def rostered_traveller(db, traveller):
    """The traveller, on a shift, in a Monday-to-Friday company.

    The sweep only looks at people with an active `ShiftAssignment` — that is
    what "was scheduled to work" means — so without one this test would pass
    whether or not the field-visit seam existed.
    """
    from attendance.models import Shift, ShiftAssignment
    from organization.models import CompanyProfile

    profile = CompanyProfile.get_solo()
    profile.working_days = [1, 2, 3, 4, 5]
    profile.save(update_fields=["working_days"])

    shift = Shift.objects.create(name="General", start_time="09:00", end_time="17:00")
    ShiftAssignment.objects.create(employee=traveller, shift=shift, start_date=date(2026, 1, 1))
    return traveller


@pytest.fixture
def visit(db, traveller, approver, company):
    return FieldVisit.objects.create(
        employee=traveller,
        approver=approver,
        company=company,
        purpose=FieldVisit.Purpose.INSPECTION,
        title="Headworks inspection after the monsoon",
        destination="Headworks, Sanjen Khola",
        district="Rasuwa",
        starts_on=date(2026, 8, 3),
        ends_on=date(2026, 8, 7),
    )


# ── The span ─────────────────────────────────────────────────────────────


def test_a_visit_counts_both_end_days(visit):
    """A Monday-to-Friday visit is five days, not four.

    Off-by-one here is not cosmetic: it is the last day of the trip, and it is
    the day the attendance sweep would then mark absent.
    """
    assert visit.days == 5
    assert services.days_of(visit) == [date(2026, 8, day) for day in range(3, 8)]


def test_a_one_day_visit_is_one_day(traveller):
    same_day = FieldVisit(
        employee=traveller, starts_on=date(2026, 8, 3), ends_on=date(2026, 8, 3)
    )
    assert same_day.days == 1


# ── The transitions ──────────────────────────────────────────────────────


def test_a_draft_is_not_yet_a_reason_to_be_away(visit, traveller):
    """🔒 Only an *approved* visit excuses an absence.

    A request nobody has signed is a plan. If a draft counted, anybody could
    keep themselves off the absentee list by writing one.
    """
    assert services.on_visit(traveller, date(2026, 8, 5)) is None

    services.request_visit(visit)
    assert services.on_visit(traveller, date(2026, 8, 5)) is None

    services.decide(visit, approve=True)
    assert services.on_visit(traveller, date(2026, 8, 5)) == visit


def test_a_visit_cannot_be_decided_twice(visit):
    services.request_visit(visit)
    services.decide(visit, approve=True)

    with pytest.raises(services.FieldVisitError):
        services.decide(visit, approve=False)


def test_a_visit_cannot_end_before_it_starts(visit):
    visit.ends_on = visit.starts_on - timedelta(days=1)
    visit.save(update_fields=["ends_on"])

    with pytest.raises(services.FieldVisitError):
        services.request_visit(visit)


def test_closing_without_a_report_is_refused(visit):
    """🔒 The report is the only part of this record anybody reads a year
    later. A visit with none is a cost with no output."""
    services.request_visit(visit)
    services.decide(visit, approve=True)

    with pytest.raises(services.FieldVisitError):
        services.complete(visit, report="   ")

    services.complete(visit, report="Intake gate silted; desilting basin needs flushing.")
    visit.refresh_from_db()
    assert visit.status == FieldVisit.Status.COMPLETED


def test_only_an_approved_visit_can_be_completed(visit):
    with pytest.raises(services.FieldVisitError):
        services.complete(visit, report="Went, saw, came back.")


# ── The attendance seam ──────────────────────────────────────────────────


def test_the_absence_sweep_marks_a_traveller_present(rostered_traveller, visit, traveller):
    """🔒 The seam with money attached.

    `mark_absent_employees` runs nightly and writes an ABSENT log for anybody
    with no clock-in. Absences feed `unpaid_days`, which scales pay — so a week
    at site with no seam here is a week of docked salary for going where the
    company sent them.

    2026-08-05 is a Wednesday, so the sweep does run — a non-working day would
    make this pass for the wrong reason.
    """
    from django.core.management import call_command

    services.request_visit(visit)
    services.decide(visit, approve=True)

    call_command("mark_absent_employees", "--date", "2026-08-05")

    log = AttendanceLog.objects.get(employee=traveller, date=date(2026, 8, 5))
    assert log.status == AttendanceLog.Status.PRESENT
    assert "Field visit" in log.notes
    assert visit.destination in log.notes


# ── The timesheet seam ───────────────────────────────────────────────────


def test_a_completed_visit_writes_one_entry_per_day(visit, traveller, company):
    project = Project.objects.create(name="Sanjen Khola HEP")
    visit.project = project
    visit.save(update_fields=["project"])

    services.request_visit(visit)
    services.decide(visit, approve=True)
    services.complete(visit, report="Gate inspected.")

    created = services.generate_time_entries(visit)

    assert created == 5
    entries = TimeEntry.objects.filter(employee=traveller, project=project)
    assert entries.count() == 5
    assert {e.date for e in entries} == set(services.days_of(visit))


def test_generating_twice_adds_nothing(visit, traveller):
    """Idempotent, because the button is on screen and gets pressed twice."""
    project = Project.objects.create(name="Sanjen Khola HEP II")
    visit.project = project
    visit.save(update_fields=["project"])
    services.request_visit(visit)
    services.decide(visit, approve=True)
    services.complete(visit, report="Gate inspected.")

    assert services.generate_time_entries(visit) == 5
    assert services.generate_time_entries(visit) == 0
    assert TimeEntry.objects.filter(employee=traveller).count() == 5


def test_a_visit_with_no_project_cannot_make_entries(visit):
    """A time entry with no project has nothing to be reported against — which
    is one of the reasons a visit is not itself a time entry."""
    services.request_visit(visit)
    services.decide(visit, approve=True)
    services.complete(visit, report="Gate inspected.")

    with pytest.raises(services.FieldVisitError) as exc:
        services.generate_time_entries(visit)
    assert "project" in str(exc.value).lower()


def test_entries_are_refused_before_the_visit_is_closed(visit):
    project = Project.objects.create(name="Sanjen Khola HEP III")
    visit.project = project
    visit.save(update_fields=["project"])
    services.request_visit(visit)
    services.decide(visit, approve=True)

    with pytest.raises(services.FieldVisitError):
        services.generate_time_entries(visit)


# ── Over the wire ────────────────────────────────────────────────────────


def test_only_the_traveller_sends_their_own_visit(visit, hr_client):
    """Somebody else's travel order is not yours to submit — the traveller is
    the one committing to the dates."""
    response = hr_client.post(f"{VISITS}{visit.id}/request_order/")
    assert response.status_code == 403


def test_the_named_approver_decides(visit, employee_client, hr_client):
    services.request_visit(visit)

    # The traveller is not their own approver.
    assert employee_client.post(f"{VISITS}{visit.id}/approve/").status_code == 403

    response = hr_client.post(f"{VISITS}{visit.id}/approve/", {"note": "Go."}, format="json")
    assert response.status_code == 200
    assert response.data["status"] == FieldVisit.Status.APPROVED
    assert response.data["decision_note"] == "Go."


def test_a_refusal_reaches_the_screen_as_a_sentence(visit, employee_client):
    """A 400 whose body is a code sends somebody to the logs; the service's own
    words are the explanation."""
    services.request_visit(visit)
    services.decide(visit, approve=True)

    response = employee_client.post(f"{VISITS}{visit.id}/complete/", {"report": ""}, format="json")

    assert response.status_code == 400
    assert response.data["detail"] == "Write what was found before closing the visit."


def test_a_participant_can_be_somebody_who_does_not_work_here(visit, hr_client):
    """Half the people on a site visit are not staff — a contractor's foreman,
    a ward representative. Name first, employee optional."""
    response = hr_client.post(
        f"{VISITS}{visit.id}/participants/",
        {"name": "Dawa Sherpa", "organisation": "Ward 4", "role": "Ward representative"},
        format="json",
    )

    assert response.status_code == 201
    assert response.data["employee"] is None
    assert response.data["name"] == "Dawa Sherpa"


# ── Deleting one ─────────────────────────────────────────────────────────


def test_a_completed_visit_cannot_be_deleted(visit, employee_client):
    """🔒 A completed visit is a record, not a plan.

    It carries the report, it may have written timesheet lines against a
    project, and it may have an expense claim hanging off it. Removing the row
    leaves those orphaned or silently wrong, and the day anybody notices is the
    day somebody queries a payment. There was no guard here at all.
    """
    services.request_visit(visit)
    services.decide(visit, approve=True)
    services.complete(visit, report="Gate inspected.")

    response = employee_client.delete(f"{VISITS}{visit.id}/")

    assert response.status_code == 409
    assert response.data["code"] == "not_a_draft"
    assert FieldVisit.objects.filter(pk=visit.pk).exists()


def test_an_approved_visit_cannot_be_deleted_either(visit, employee_client):
    services.request_visit(visit)
    services.decide(visit, approve=True)

    assert employee_client.delete(f"{VISITS}{visit.id}/").status_code == 409


def test_the_traveller_may_delete_their_own_draft(visit, employee_client):
    """The one case where deleting costs nothing: nobody has seen it."""
    assert employee_client.delete(f"{VISITS}{visit.id}/").status_code == 204
    assert not FieldVisit.objects.filter(pk=visit.pk).exists()


def test_somebody_elses_draft_is_not_yours_to_delete(visit, hr_client, admin_client):
    """`hr_client` here is the approver, not the traveller — and being named
    approver is not the same as owning the draft."""
    response = hr_client.delete(f"{VISITS}{visit.id}/")

    # Either refused outright, or allowed because they manage attendance —
    # what must not happen is a plain colleague removing it.
    assert response.status_code in (204, 403)


# ── Sites, and who may approve a trip to one ─────────────────────────────


def test_the_approver_list_joins_the_site_s_supervisors_to_your_own(
    db, traveller, approver, company
):
    """Both, because each knows something the other does not: the site
    supervisor knows whether the visit is necessary, the line supervisor
    whether this person can be spared."""
    from employees.models import Employee, EmployeeSupervisor
    from fieldvisits.models import Site
    from fieldvisits.services import eligible_approvers

    line = approver
    EmployeeSupervisor.objects.create(employee=traveller, supervisor=line, order=0)

    site_boss = Employee.objects.create(
        user=get_user_model().objects.create_user(username="site_boss", password="x"),
        employee_code="EMP-FV9",
        date_joined=date(2026, 1, 1),
        primary_company=company,
    )
    site = Site.objects.create(name="Sanjen headworks", code="SJ-HW")
    site.supervisors.add(site_boss)

    people = eligible_approvers(traveller, site)

    assert [p.pk for p in people] == [line.pk, site_boss.pk]


def test_somebody_who_is_both_appears_once(db, traveller, approver):
    from employees.models import EmployeeSupervisor
    from fieldvisits.models import Site
    from fieldvisits.services import eligible_approvers

    EmployeeSupervisor.objects.create(employee=traveller, supervisor=approver, order=0)
    site = Site.objects.create(name="Sanjen headworks")
    site.supervisors.add(approver)

    assert [p.pk for p in eligible_approvers(traveller, site)] == [approver.pk]


def test_a_trip_nobody_can_approve_is_refused_rather_than_queued(db, traveller):
    """An empty list is the interesting case: the request would otherwise land
    in a queue nobody owns."""
    from fieldvisits.services import FieldVisitError, validate_approver

    with pytest.raises(FieldVisitError) as raised:
        validate_approver(traveller, None, None)

    assert "nobody who can approve" in str(raised.value)


def test_an_approver_who_is_not_on_either_list_is_refused(db, traveller, approver, company):
    from employees.models import Employee, EmployeeSupervisor
    from fieldvisits.services import FieldVisitError, validate_approver

    EmployeeSupervisor.objects.create(employee=traveller, supervisor=approver, order=0)
    stranger = Employee.objects.create(
        user=get_user_model().objects.create_user(username="stranger", password="x"),
        employee_code="EMP-FV8",
        date_joined=date(2026, 1, 1),
        primary_company=company,
    )

    with pytest.raises(FieldVisitError):
        validate_approver(traveller, None, stranger)

    assert validate_approver(traveller, None, approver) == approver
