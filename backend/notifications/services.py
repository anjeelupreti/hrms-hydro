import json
import logging

from django.conf import settings
from django.db import transaction
from pywebpush import WebPushException, webpush

from core.email import send_templated_mail
from notifications.models import (
    MeetingAttendee,
    Notification,
    NotificationPreference,
    PushSubscription,
)

logger = logging.getLogger(__name__)


def _preferences_for(user):
    prefs, _ = NotificationPreference.objects.get_or_create(user=user)
    return prefs


def _send_push(user, verb, message):
    if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_PUBLIC_KEY):
        return  # no VAPID keys configured — push silently disabled, not an error
    for subscription in PushSubscription.objects.filter(user=user):
        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                },
                data=json.dumps({"title": "HRMS", "body": message, "verb": verb}),
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": f"mailto:{settings.VAPID_CONTACT_EMAIL}"},
            )
        except WebPushException as exc:
            status_code = getattr(exc.response, "status_code", None)
            if status_code in (404, 410):
                # Browser/OS says this subscription is gone for good —
                # clean it up rather than retrying it forever.
                subscription.delete()
            else:
                logger.warning("Web push failed for user %s: %s", user, exc)


def notify(user, verb, message, email_subject=None, attachments=None):
    """Creates the in-app notification and/or sends email/push, per the
    recipient's NotificationPreference (defaults: email + in-app on,
    push off until the user opts in via the browser permission prompt).

    `attachments` (list of (filename, bytes, mimetype)) ride along on the
    email — e.g. a training certificate PDF."""
    prefs = _preferences_for(user)
    if prefs.in_app_enabled:
        Notification.objects.create(recipient=user, verb=verb, message=message)
    if prefs.email_enabled and user.email:
        # Guarded, because every path in the product that notifies somebody
        # goes through here: an unreachable mail server would otherwise raise
        # out of `notify`, out of the view, and take down whatever was being
        # announced — approving leave, inviting to a meeting, provisioning an
        # employee, a platform broadcast.
        #
        # **Announcing something is not the something.** The notification is the
        # durable record and it is already written; the email is a courtesy on
        # top. A courtesy that fails must not undo the act.
        #
        # Push has always been guarded exactly this way — see `_send_push`,
        # which tolerates a dead endpoint per subscription. The asymmetry was
        # the bug: two side channels, one fatal and one not.
        #
        # Logged, never swallowed silently. A workspace whose mail is
        # misconfigured needs that visible somewhere, and the setup checklist
        # already asks for outgoing email precisely because of what depends on
        # it.
        try:
            send_templated_mail(
                email_subject or "HRMS notification",
                [user.email],
                heading=email_subject or "New notification",
                greeting=f"Hi {user.get_short_name() or user.get_username()},",
                intro=message,
                attachments=attachments,
            )
        except Exception:  # noqa: BLE001 — any transport failure, not just SMTP
            logger.exception(
                "Could not email the %r notification to %s; the in-app "
                "notification stands.",
                verb,
                user.get_username(),
            )
    if prefs.push_enabled:
        _send_push(user, verb, message)


@transaction.atomic
def invite_attendees(event, employees, actor=None):
    """Creates a MeetingAttendee row per employee (skipping anyone already
    invited) and notifies each — the same "notify on creation" pattern as
    every other workflow in this codebase."""
    created = []
    for employee in employees:
        attendee, was_created = MeetingAttendee.objects.get_or_create(
            event=event, employee=employee, defaults={"created_by": actor, "updated_by": actor}
        )
        if was_created:
            created.append(attendee)
            notify(
                employee.user,
                "meeting_invited",
                f"You've been invited to \"{event.title}\" on {event.start_datetime:%Y-%m-%d %H:%M}.",
                email_subject="Meeting invitation",
            )
    return created


def respond_to_invite(attendee, status, actor=None):
    attendee.rsvp_status = status
    attendee.updated_by = actor
    attendee.save(update_fields=["rsvp_status", "updated_by", "updated_at"])
    return attendee


def publish_announcement(announcement):
    """Notifies the target audience (one department, or every active
    employee if none is set) — no separate delivery mechanism, reuses
    notify() like everything else."""
    from employees.models import Employee

    scope = Employee.objects.filter(employment_status=Employee.EmploymentStatus.ACTIVE)
    if announcement.department_id:
        scope = scope.filter(department_id=announcement.department_id)

    for employee in scope.select_related("user"):
        notify(
            employee.user,
            "announcement_posted",
            f"{announcement.title}: {announcement.body}",
            email_subject=f"Announcement: {announcement.title}",
        )


def circulate_decision(decision, actor=None):
    """Put a decision to everybody who was invited, and tell them.

    A position row per person, created once — re-circulating a decision does
    not wipe the answers already given, which is what somebody pressing the
    button twice would otherwise do.
    """
    from django.utils import timezone

    from notifications.models import DecisionPosition, MeetingDecision

    meeting = decision.meeting
    for attendee in meeting.attendees.select_related("employee__user"):
        row, created = DecisionPosition.objects.get_or_create(
            decision=decision,
            employee=attendee.employee,
            defaults={"created_by": actor, "updated_by": actor},
        )
        if created:
            notify(
                attendee.employee.user,
                "decision_circulated",
                f'A decision from "{meeting.title}" needs your consent or dissent.',
                email_subject="A meeting decision needs your response",
            )

    decision.status = MeetingDecision.Status.CIRCULATED
    decision.circulated_at = timezone.now()
    decision.updated_by = actor
    decision.save(update_fields=["status", "circulated_at", "updated_by", "updated_at"])
    return decision


def record_position(row, *, position, reason="", actor=None):
    """One person's consent, dissent or abstention.

    Raises `ValueError` for anything the record would be worse for holding: a
    consent with no signature to stamp, or a dissent with no reason. The
    viewset turns those into a 400 with the message.
    """
    from django.utils import timezone

    from employees.models import Signature
    from notifications.models import DecisionPosition

    if position not in DecisionPosition.Position.values or position == "pending":
        raise ValueError("Choose consent, dissent or abstain.")

    if position == DecisionPosition.Position.CONSENT:
        signature = Signature.objects.filter(
            employee=row.employee, status=Signature.Status.APPROVED
        ).first()
        if signature is None:
            raise ValueError(
                "You have no approved signature yet. Upload one on your workspace "
                "and ask HR to approve it."
            )
        row.signature = signature
        row.reason = ""
    else:
        row.signature = None
        if position == DecisionPosition.Position.DISSENT and not (reason or "").strip():
            raise ValueError("Say why you disagree — a dissent without a reason records nothing.")
        row.reason = (reason or "").strip()

    row.position = position
    row.answered_at = timezone.now()
    row.updated_by = actor
    row.save(update_fields=["position", "signature", "reason", "answered_at", "updated_by", "updated_at"])
    return row


#: The shape a minute takes when nobody has configured one.
#:
#: Seeded rather than hardcoded into the builder, so an office can change it —
#: which is the whole reason `MinutesTemplate` is a table. These headings are
#: the ones most Nepali company minutes actually carry.
DEFAULT_MINUTES_SECTIONS = [
    ("Present", "attendance", ""),
    ("Agenda", "agenda", ""),
    ("Matters discussed", "manual", "What was said, item by item."),
    ("Decisions", "decisions", ""),
    ("Consent and dissent", "consent_table", ""),
]


def default_minutes_template():
    """The configured default, created on first use if there is none.

    Falls back to creating rather than raising, for the same reason
    `leave.get_default_chain` does: a missing configuration row should not be
    able to stop somebody writing up a meeting.
    """
    from notifications.models import MinutesSection, MinutesTemplate

    template = MinutesTemplate.objects.filter(is_default=True, is_active=True).first()
    if template:
        return template

    template = MinutesTemplate.objects.create(name="Standard minutes", is_default=True)
    for order, (heading, source, hint) in enumerate(DEFAULT_MINUTES_SECTIONS):
        MinutesSection.objects.create(
            template=template, order=order, heading=heading, source=source, hint=hint
        )
    return template


def build_minutes_body(meeting, template):
    """Draft a minute from the template, the register and the decisions.

    **The sections that can be filled in are filled in.** The register and the
    decision list are already known to the meeting; retyping them into the
    minute is how a minute comes to disagree with the record it summarises. A
    `MANUAL` section gets its heading and an empty paragraph, which is the
    invitation to write.

    Returns HTML in the same allow-list the memorandum uses — this is a
    starting draft, and everything in it is editable afterwards.
    """
    from html import escape

    from notifications.models import MeetingAttendee, MinutesSection

    def name(employee):
        user = employee.user
        label = user.get_full_name() or user.get_username()
        code = employee.employee_code or ""
        return f"{label} ({code})" if code else label

    parts = []
    for section in template.sections.all():
        parts.append(f"<h3>{escape(section.heading)}</h3>")

        if section.source == MinutesSection.Source.ATTENDANCE:
            present = [a for a in meeting.attendees.all() if a.attendance == "present"]
            absent = [a for a in meeting.attendees.all() if a.attendance == "absent"]
            unmarked = [a for a in meeting.attendees.all() if a.attendance == "unmarked"]
            if present:
                parts.append(
                    "<p><strong>Present:</strong> "
                    + escape(", ".join(name(a.employee) for a in present))
                    + "</p>"
                )
            if absent:
                parts.append(
                    "<p><strong>Apologies:</strong> "
                    + escape(", ".join(name(a.employee) for a in absent))
                    + "</p>"
                )
            if unmarked:
                # Said plainly rather than folded into either list — the
                # register was not taken, and a minute should not imply it was.
                parts.append(
                    "<p><em>Not recorded:</em> "
                    + escape(", ".join(name(a.employee) for a in unmarked))
                    + "</p>"
                )
            if not meeting.attendees.exists():
                parts.append("<p><em>Nobody was invited.</em></p>")

        elif section.source == MinutesSection.Source.AGENDA:
            items = list(meeting.agenda_items.all())
            if items:
                parts.append("<ol>")
                for item in items:
                    line = escape(item.title)
                    if item.raised_in_meeting:
                        line += " <em>(raised in the meeting)</em>"
                    parts.append(f"<li>{line}</li>")
                parts.append("</ol>")
            else:
                parts.append("<p><em>No agenda was recorded.</em></p>")

        elif section.source == MinutesSection.Source.DECISIONS:
            decisions = list(meeting.decisions.all())
            if decisions:
                parts.append("<ol>")
                for decision in decisions:
                    parts.append(f"<li>{escape(decision.text)}</li>")
                parts.append("</ol>")
            else:
                parts.append("<p><em>No decisions were recorded.</em></p>")

        elif section.source == MinutesSection.Source.CONSENT_TABLE:
            # Left to the page to draw. The table needs the signature images,
            # which are files rather than text — see `MinutesConsentTable` in
            # the frontend. A marker keeps its place in the document.
            parts.append('<p data-minutes-consent-table="1"></p>')

        else:
            parts.append(f"<p>{escape(section.hint)}</p>" if section.hint else "<p><br></p>")

    return "".join(parts)


def mint_minute_id(minute, company=None):
    """Give a minute its number, under a row lock.

    `MIN-<company code>-<serial>`. The prefix is there because these are filed
    alongside memoranda and travel orders, and a bare number in a folder tells
    nobody which register it came out of.
    """
    from django.db import transaction

    from companies.models import primary_company
    from notifications.models import MinutesCounter

    # **Whose paper is it?** The meeting itself has no company — the calendar
    # is shared across the group — so this is resolved in the order the answer
    # is most likely to be right: what the caller said, what the minute already
    # says, the company of whoever called the meeting, and finally the group's
    # primary company.
    if company is None:
        company = minute.company
    if company is None:
        # What whoever called the meeting chose. This is the answer in every
        # ordinary case; the two below it are for meetings created before the
        # field existed, and for a caller with no employee record.
        company = minute.meeting.company
    if company is None:
        organiser = getattr(minute.meeting.created_by, "employee", None)
        company = getattr(organiser, "primary_company", None)
    if company is None:
        company = primary_company()
    if company is None:
        # No company anywhere. The minute is still a minute; it simply has no
        # register to be numbered in, and saying so beats inventing one.
        return minute

    with transaction.atomic():
        counter, _ = MinutesCounter.objects.get_or_create(company=company)
        counter = MinutesCounter.objects.select_for_update().get(pk=counter.pk)
        serial = counter.next_serial
        counter.next_serial = serial + 1
        counter.save(update_fields=["next_serial"])

    minute.company = company
    minute.serial_number = serial
    minute.minute_id = f"MIN-{company.code}-{serial:04d}"
    minute.save(update_fields=["company", "serial_number", "minute_id"])
    return minute
