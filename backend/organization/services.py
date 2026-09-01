from django.db import transaction
from django.utils import timezone

from employees.models import Employee
from notifications.services import notify
from organization.models import Review, ReviewCycle


@transaction.atomic
def start_cycle(cycle):
    """Creates one Review per active employee, snapshotting their current
    manager as reviewer. Idempotent: re-running (e.g. for employees added
    after the first start) only creates rows that don't already exist."""
    cycle.status = ReviewCycle.Status.ACTIVE
    cycle.save(update_fields=["status", "updated_at"])

    created = 0
    for employee in Employee.objects.filter(employment_status=Employee.EmploymentStatus.ACTIVE):
        _, was_created = Review.objects.get_or_create(
            cycle=cycle, employee=employee, defaults={"reviewer": employee.manager}
        )
        if was_created:
            created += 1
            notify(
                employee.user,
                "review_cycle_started",
                f"The '{cycle.name}' review cycle has started — please complete your self-assessment.",
                email_subject="Performance review cycle started",
            )
    return created


@transaction.atomic
def submit_self_assessment(review, text, rating):
    review.self_assessment = text
    review.self_rating = rating
    review.self_submitted_at = timezone.now()
    review.status = (
        Review.Status.PENDING_MANAGER if review.reviewer_id else Review.Status.COMPLETED
    )
    review.save(
        update_fields=["self_assessment", "self_rating", "self_submitted_at", "status", "updated_at"]
    )
    if review.reviewer_id:
        notify(
            review.reviewer.user,
            "review_pending_manager",
            f"{review.employee.user.get_full_name() or review.employee.employee_code} submitted their "
            f"self-assessment for '{review.cycle.name}' — your review is next.",
            email_subject="Performance review awaiting your input",
        )
    return review


@transaction.atomic
def submit_manager_assessment(review, actor, text, rating):
    review.manager_assessment = text
    review.manager_rating = rating
    review.manager_submitted_at = timezone.now()
    review.status = Review.Status.COMPLETED
    review.updated_by = actor
    review.save(
        update_fields=[
            "manager_assessment",
            "manager_rating",
            "manager_submitted_at",
            "status",
            "updated_by",
            "updated_at",
        ]
    )
    notify(
        review.employee.user,
        "review_completed",
        f"Your manager has completed your review for '{review.cycle.name}'.",
        email_subject="Your performance review is complete",
    )
    return review
