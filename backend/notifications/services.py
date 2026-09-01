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
