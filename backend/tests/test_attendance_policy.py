"""How a company clocks in, and how it refuses the ways it does not.

The interesting tests here are the **refusals that must not happen**. A policy
that can lock a company out of its own attendance is worse than no policy at
all, because attendance feeds payroll — so the tests that matter most are the
ones proving HR can always record a day, and that a company which never
configured anything is unaffected.
"""

from datetime import date

import pytest

from attendance.models import AttendanceLog
from attendance.policy import (
    AttendancePolicy,
    AttendanceSourceError,
    EmployeeAttendanceMethod,
    allows,
    require,
)
from employees.models import Employee

pytestmark = pytest.mark.django_db


@pytest.fixture
def person(company, employee_user):
    yield Employee.objects.create(
        user=employee_user, employee_code="EMP-9001", date_joined=date(2026, 1, 1)
    )


# ── Silence permits ──────────────────────────────────────────────────────


def test_an_unconfigured_company_is_unaffected(company, person):
    """The whole feature is additive. A company that never opened the setting
    must behave exactly as it did before this module existed — otherwise the
    deploy is an outage for everybody who was happy."""
    assert AttendancePolicy.objects.count() == 0
    assert allows(AttendanceLog.Source.WEB, employee=person) is True
    assert allows(AttendanceLog.Source.BIOMETRIC, employee=person) is True


# ── The company answer ───────────────────────────────────────────────────


def test_a_readers_only_company_refuses_a_web_punch(company, person):
    """The case that prompted this: a company bought biometric readers so that
    people cannot clock each other in, and web check-in was on regardless."""
    AttendancePolicy.objects.create(allow_web=False, allow_biometric=True)

    assert allows(AttendanceLog.Source.WEB, employee=person) is False
    assert allows(AttendanceLog.Source.BIOMETRIC, employee=person) is True


def test_a_web_only_company_refuses_a_device(company, person):
    AttendancePolicy.objects.create(allow_web=True, allow_biometric=False)

    assert allows(AttendanceLog.Source.BIOMETRIC, employee=person) is False


def test_the_refusal_says_what_to_do_next(company, person):
    """"Forbidden" tells somebody they are stuck. This tells them who can help."""
    AttendancePolicy.objects.create(allow_web=False)
    with pytest.raises(AttendanceSourceError) as exc:
        require(AttendanceLog.Source.WEB, employee=person)

    assert "HR" in exc.value.messages[0]


# ── HR is never locked out ───────────────────────────────────────────────


def test_hr_can_always_record_attendance(company, person):
    """🔒 The rule that keeps this from becoming an outage.

    If the reader breaks on a company configured to readers-only, nobody can be
    marked present and the month cannot be paid. Attendance feeds payroll, so a
    lockout here is a lockout from money.
    """
    AttendancePolicy.objects.create(allow_web=False, allow_biometric=False)

    assert allows(AttendanceLog.Source.MANUAL, employee=person) is True
    assert allows(AttendanceLog.Source.WEB, employee=person, by_hr=True) is True


def test_the_absence_sweep_is_never_refused(company, person):
    """A system-written absence is not somebody clocking in, and a policy that
    silenced it would leave days simply missing rather than marked absent."""
    AttendancePolicy.objects.create(allow_web=False, allow_biometric=False)

    assert allows(AttendanceLog.Source.SYSTEM, employee=person) is True


# ── The per-employee override ────────────────────────────────────────────


def test_an_employee_can_be_excepted_from_the_company_rule(company, person):
    """The factory floor uses a reader and field sales cannot. A single
    company-wide answer forces a company to pick which half of their staff is
    unsupported."""
    AttendancePolicy.objects.create(allow_web=False, allow_biometric=True)
    EmployeeAttendanceMethod.objects.create(
        employee=person, allow_web=True, note="Field sales — no reader on site"
    )

    assert allows(AttendanceLog.Source.WEB, employee=person) is True


def test_an_override_can_also_be_more_restrictive(company, person):
    """It is an override, not a permission grant — it has to work both ways."""
    AttendancePolicy.objects.create(allow_web=True, allow_biometric=True)
    EmployeeAttendanceMethod.objects.create(employee=person, allow_web=False)

    assert allows(AttendanceLog.Source.WEB, employee=person) is False


def test_an_unset_override_field_falls_back_to_the_company(company, person):
    """Null means "no opinion", which is why the override fields are nullable
    booleans rather than booleans — `False` and "unspecified" are different
    answers and a plain boolean cannot hold both."""
    AttendancePolicy.objects.create(allow_web=False, allow_biometric=True)
    EmployeeAttendanceMethod.objects.create(employee=person, allow_web=None)

    assert allows(AttendanceLog.Source.WEB, employee=person) is False


# ── Enforced where it counts ─────────────────────────────────────────────


def test_the_api_refuses_a_forbidden_web_punch(company, employee_user, person):
    """Guarded in the service, not by hiding the button. A hidden control
    leaves the API open to anybody who never saw a button."""
    from rest_framework.test import APIClient

    AttendancePolicy.objects.create(allow_web=False)

    client = APIClient()
    client.force_authenticate(user=employee_user)

    response = client.post("/api/v1/attendance/logs/check-in/")
    assert response.status_code == 403

    assert AttendanceLog.objects.filter(employee=person).count() == 0


def test_a_permitted_web_punch_still_works(company, employee_user, person):
    """A guard that blocks everything is not a guard."""
    from rest_framework.test import APIClient

    AttendancePolicy.objects.create(allow_web=True)

    client = APIClient()
    client.force_authenticate(user=employee_user)

    response = client.post("/api/v1/attendance/logs/check-in/")
    assert response.status_code == 201


def test_device_events_are_held_not_dropped_when_biometric_is_off(company, person):
    """The event keeps its reason rather than vanishing, so switching biometric
    back on does not require explaining a gap in the record."""
    from django.utils import timezone

    from attendance.models import AttendanceDeviceEvent, Device

    AttendancePolicy.objects.create(allow_biometric=False)
    device = Device.objects.create(name="Gate", serial="X1", secret_hash="h1", is_active=True)
    AttendanceDeviceEvent.objects.create(
        device=device,
        external_employee_id=person.employee_code,
        event_type=AttendanceDeviceEvent.EventType.CHECK_IN,
        raw_timestamp=timezone.now(),
    )

    from django.core.management import call_command

    call_command("process_attendance_device_events")

    event = AttendanceDeviceEvent.objects.first()
    assert event.processed is False
    assert "biometric" in event.error.lower()
    assert AttendanceLog.objects.filter(employee=person).count() == 0
