"""Removal is allowed — until the row has become binding.

The rule (see docs/checklist.md §R2): anything you can add, you must be able to
take back, *except* where something outside the system now depends on it. A
training certificate is the archetype — it is already in the participant's
hands, and the verification page renders straight from the enrollment.
"""

from datetime import date, timedelta

import pytest
from django.utils import timezone
from rest_framework import status

from accounts.models import User
from employees.models import Department, Designation, Employee
from training import services
from training.models import Enrollment, TrainingProgram, TrainingSession

pytestmark = pytest.mark.django_db


@pytest.fixture
def enrollment(company):
    user = User.objects.create_user(
        username="learner",
        email="learner@t.test",
        password="pw",
        role=User.Role.EMPLOYEE,
        first_name="Lear",
        last_name="Ner",
    )
    employee = Employee.objects.create(
        user=user,
        employee_code="EMP-LEARN",
        date_joined=date(2026, 1, 1),
        department=Department.objects.create(name="Learning", code="LRN"),
        designation=Designation.objects.create(title="Analyst"),
    )
    program = TrainingProgram.objects.create(title="Fire Safety")
    session = TrainingSession.objects.create(
        program=program,
        start_datetime=timezone.now() + timedelta(days=1),
        end_datetime=timezone.now() + timedelta(days=1, hours=2),
        capacity=10,
    )
    return Enrollment.objects.create(
        session=session, employee=employee, status=Enrollment.Status.ENROLLED
    )


def test_an_ordinary_participant_can_be_removed(company, enrollment):
    """The default has to be reversible, or the guard is just an excuse."""
    services.cancel_enrollment(enrollment)
    enrollment.refresh_from_db()

    assert enrollment.status == Enrollment.Status.CANCELLED


def test_removal_is_refused_once_a_certificate_is_issued(company, enrollment):
    enrollment.certificate_issued_at = timezone.now()
    enrollment.save(update_fields=["certificate_issued_at"])

    with pytest.raises(ValueError, match="certificate"):
        services.cancel_enrollment(enrollment)

    enrollment.refresh_from_db()

    # Still on the roster — a refused removal must not half-apply.
    assert enrollment.status == Enrollment.Status.ENROLLED


def test_the_api_explains_the_refusal_rather_than_erroring(hr_client, company, enrollment):
    """A 500 would read as "the app is broken" when the answer is "revoke the
    certificate first"."""
    enrollment.certificate_issued_at = timezone.now()
    enrollment.save(update_fields=["certificate_issued_at"])

    response = hr_client.post(f"/api/v1/training/enrollments/{enrollment.id}/cancel/")

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "certificate" in response.data["detail"].lower()


def test_the_guard_holds_for_the_participant_too(company, enrollment):
    """Self-cancellation goes through the same service, so it obeys the same
    rule — the endpoint allows either the owner or HR."""
    enrollment.certificate_issued_at = timezone.now()
    enrollment.save(update_fields=["certificate_issued_at"])

    with pytest.raises(ValueError):
        services.cancel_enrollment(enrollment, actor=enrollment.employee.user)
