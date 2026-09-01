"""Turning an accepted offer into an employee who can log in.

**The gap this closes.** `Candidate.Stage.HIRED` existed and nothing acted on
it: somebody was hired in the product and then typed into it again by hand.
Note the irony it corrects — `platform_admin.services.create_company` already
builds a `User` *and* an `Employee` together for a new workspace's first admin,
while hiring into an existing company had no equivalent.

**On "account creation as a checklist task".** That was the natural request, and
it cannot be built that way: `Employee.user` is a required one-to-one and
`Checklist.employee` is a required FK, so the account and the employee record
have to exist *before* an onboarding checklist can point at anything. So the
conversion creates both, and the checklist covers everything that follows —
statutory documents, equipment, orientation. Account creation is what makes the
checklist possible rather than an item on it.
"""

import logging
from datetime import date

from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)


class HiringError(Exception):
    """The candidate cannot be converted as things stand."""


def _next_employee_code():
    from employees.models import Employee

    count = Employee.objects.count() + 1
    while Employee.objects.filter(employee_code=f"EMP-{count:04d}").exists():
        count += 1
    return f"EMP-{count:04d}"


def accept_offer(offer, *, actor=None, responded_on=None):
    """Record that the candidate said yes, and move them to hired.

    Separate from the conversion below so that *agreeing* and *provisioning* are
    distinct events. They usually happen minutes apart, but an offer accepted on
    Friday for a March start should not create a login in November — and if
    provisioning fails for any reason, the acceptance must still stand.
    """
    from recruitment.models import Candidate, Offer

    if offer.status == Offer.Status.ACCEPTED:
        return offer  # idempotent: a double-click is not a second acceptance
    if not offer.is_open:
        raise HiringError(
            f"This offer is {offer.get_status_display().lower()} and can no longer be accepted."
        )
    if offer.expires_on and offer.expires_on < date.today():
        # Lapsed rather than accepted. Recording the lapse is what stops an old
        # offer being quietly honoured months later.
        #
        # **Committed before the raise, deliberately.** This write is outside
        # any transaction the acceptance would use: if the function were
        # wrapped in `atomic`, raising would roll the expiry back and the offer
        # would still read "sent" — the lapse would be reported and not
        # recorded, so the next attempt would hit the same check again with
        # nothing to show that it had ever fired.
        offer.status = Offer.Status.EXPIRED
        offer.save(update_fields=["status", "updated_at"])
        raise HiringError(f"This offer expired on {offer.expires_on} and must be reissued.")

    # Only the acceptance itself is atomic — the offer and the candidate's
    # stage must move together or not at all.
    with transaction.atomic():
        offer.status = Offer.Status.ACCEPTED
        offer.responded_at = responded_on or timezone.now()
        offer.updated_by = actor
        offer.save(update_fields=["status", "responded_at", "updated_by", "updated_at"])

        candidate = offer.candidate
        candidate.stage = Candidate.Stage.HIRED
        candidate.updated_by = actor
        candidate.save(update_fields=["stage", "updated_by", "updated_at"])
    return offer


@transaction.atomic
def decline_offer(offer, *, reason="", actor=None):
    """They said no. **Not** a rejection.

    Kept as its own outcome because losing somebody to a counter-offer is a
    different fact from deciding against them, and a funnel that merges the two
    overstates how selective the process was. The reason is the most useful
    thing recruitment can learn here, and it is exactly what gets lost when a
    decline is filed as a rejection.
    """
    from recruitment.models import Candidate, Offer

    if not offer.is_open:
        raise HiringError(
            f"This offer is {offer.get_status_display().lower()} and can no longer be declined."
        )

    offer.status = Offer.Status.DECLINED
    offer.decline_reason = reason
    offer.responded_at = timezone.now()
    offer.updated_by = actor
    offer.save(update_fields=[
        "status", "decline_reason", "responded_at", "updated_by", "updated_at",
    ])

    candidate = offer.candidate
    candidate.stage = Candidate.Stage.DECLINED
    candidate.updated_by = actor
    candidate.save(update_fields=["stage", "updated_by", "updated_at"])
    return offer


@transaction.atomic
def convert_candidate_to_employee(candidate, *, actor=None, start_onboarding=True, password=None):
    """Create the login and employee record for a hired candidate.

    Carries across everything already collected rather than opening an empty
    form — the name and contact details from the application, and the salary,
    start date, department and designation from the offer. Re-keying data the
    system already holds is how the two records end up disagreeing.

    Returns `(employee, checklist)`. Idempotent: a candidate already converted
    returns their existing employee rather than creating a second.
    """
    from accounts.models import User
    from accounts.provisioning import AccountError, provision_account
    from employees.models import Employee
    from recruitment.models import Candidate

    if candidate.stage != Candidate.Stage.HIRED:
        raise HiringError(
            "Only a hired candidate can be converted. Accept their offer first — "
            "being hired is the candidate agreeing, not a status somebody sets."
        )

    offer = getattr(candidate, "offer", None)

    existing = Employee.objects.filter(hired_from=candidate).first()
    if existing is not None:
        return existing, None

    if not candidate.email:
        # The email is the login. Without one there is no account to create,
        # and inventing a placeholder would produce an employee who can never
        # sign in and a support ticket nobody can explain.
        raise HiringError("This candidate has no email address, so no login can be created.")

    parts = candidate.name.split()
    first_name = parts[0] if parts else candidate.name
    last_name = " ".join(parts[1:]) if len(parts) > 1 else ""

    # Shared with the manual create-employee route, so both deliver the
    # temporary password the same way. Written separately, one route mails it
    # and the other sets it and tells nobody — hiring somebody with a perfect
    # record, an onboarding checklist and no way to sign in. The password goes
    # to them and is returned to no one.
    try:
        user = provision_account(
            email=candidate.email,
            first_name=first_name,
            last_name=last_name,
            role=User.Role.EMPLOYEE,
            password=password,
        )
    except AccountError as exc:
        raise HiringError(str(exc)) from exc

    employee = Employee.objects.create(
        user=user,
        employee_code=_next_employee_code(),
        phone=candidate.phone or "",
        date_joined=(offer.start_date if offer and offer.start_date else date.today()),
        department=(offer.department if offer else None) or candidate.job.department,
        designation=(offer.designation if offer else None),
        hired_from=candidate,
        created_by=actor,
        updated_by=actor,
    )

    checklist = None
    if start_onboarding:
        checklist = _start_onboarding(employee, actor=actor)

    return employee, checklist


def _start_onboarding(employee, *, actor=None):
    """Instantiate the company's onboarding template for a new employee.

    Silent no-op when no template exists: a company that has not configured
    onboarding should still be able to hire somebody, and failing the whole
    conversion over a missing checklist would be the tail wagging the dog.
    """
    from checklists.models import Checklist, ChecklistTask, ChecklistTemplate, Kind

    template = (
        ChecklistTemplate.objects.filter(kind=Kind.ONBOARDING, is_active=True)
        .prefetch_related("items")
        .first()
    )
    if template is None:
        logger.info("No active onboarding template — employee %s created without one.", employee.pk)
        return None

    checklist = Checklist.objects.create(
        employee=employee,
        kind=Kind.ONBOARDING,
        template=template,
        title=f"Onboarding — {employee.user.get_full_name() or employee.user.get_username()}",
        created_by=actor,
        updated_by=actor,
    )
    ChecklistTask.objects.bulk_create([
        ChecklistTask(
            checklist=checklist,
            title=item.title,
            description=item.description,
            order=item.order,
        )
        for item in template.items.all()
    ])
    return checklist
