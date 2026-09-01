"""What happened to a thing, when, and who could see it.

**The shape lives here; each surface declares its own table.** A deal and a
client-desk ticket record the same kinds of thing — a note, a call, a status
change — and defining that once means a new surface inherits the vocabulary
rather than inventing a fourth spelling of "note".

**Visibility is a field, not a convention.** An internal note and a reply the
customer reads differ by one flag, because the alternative — remembering which
table is which — is how an internal comment ends up in front of a customer. That
is the one unrecoverable mistake a support module can make, so the default is
*internal*: the safe direction to be wrong in.

**Status changes are events, not a column update.** `updated_at` says something
changed; it cannot say a ticket sat in "waiting on customer" for nine days.
Duration-in-status is the most useful number either surface produces, and it is
only computable if transitions were written down as they happened.
"""

from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models
from django.utils import timezone


class TimelineKind(models.TextChoices):
    NOTE = "note", "Note"
    CALL = "call", "Call"
    EMAIL = "email", "Email"
    MEETING = "meeting", "Meeting"
    STATUS = "status", "Status change"
    ASSIGNMENT = "assignment", "Assignment"
    # A reply the other party actually receives, as distinct from a note about
    # them. Separate because they are different acts, not different wordings.
    REPLY = "reply", "Reply to customer"
    SYSTEM = "system", "System"


class TimelineVisibility(models.TextChoices):
    INTERNAL = "internal", "Internal only"
    CUSTOMER = "customer", "Visible to the customer"


class AbstractTimelineEntry(models.Model):
    """One thing that happened to a lead, a deal or a ticket.

    Append-only by intent: this records what occurred, and editing it afterwards
    would make it a description of what somebody later wished had occurred.
    Corrections are new entries.

    Concrete subclasses add the `actor` foreign key, which is the one field that
    cannot be shared across the schema boundary.
    """

    # Generic, so one table serves several subjects within its own schema
    # without those apps importing each other.
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveBigIntegerField()
    subject = GenericForeignKey("content_type", "object_id")

    kind = models.CharField(max_length=20, choices=TimelineKind.choices, default=TimelineKind.NOTE)
    visibility = models.CharField(
        max_length=20,
        choices=TimelineVisibility.choices,
        default=TimelineVisibility.INTERNAL,
        help_text="Defaults to internal — the safe direction to be wrong in.",
    )
    body = models.TextField(blank=True)

    # For STATUS and ASSIGNMENT entries. Free text rather than foreign keys,
    # because one table describes transitions in several status vocabularies and
    # a nullable FK per surface would be columns that are null almost always.
    from_value = models.CharField(max_length=100, blank=True)
    to_value = models.CharField(max_length=100, blank=True)

    actor_label = models.CharField(
        max_length=150,
        blank=True,
        help_text="Who acted, when they are not a user of this system — a "
                  "customer replying by email, for instance.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_kind_display()} on {self.content_type}#{self.object_id}"

    @property
    def who(self):
        actor = getattr(self, "actor", None)
        if actor is not None:
            return actor.get_full_name() or actor.get_username()
        return self.actor_label or "System"


# ── Helpers, parameterised by the concrete model ─────────────────────────
#
# Each caller passes its own timeline model. Slightly more to type than a bare
# `record(subject, ...)`, and it makes the schema boundary visible at every call
# site rather than hiding a decision about *which table* inside a helper.


def record(model, subject, *, kind=TimelineKind.NOTE, body="", actor=None,
           actor_label="", visibility=TimelineVisibility.INTERNAL,
           from_value="", to_value=""):
    """Write one entry against any subject."""
    return model.objects.create(
        content_type=ContentType.objects.get_for_model(subject),
        object_id=subject.pk,
        kind=kind,
        visibility=visibility,
        body=body,
        from_value=str(from_value or ""),
        to_value=str(to_value or ""),
        actor=actor,
        actor_label=actor_label,
    )


def record_status_change(model, subject, from_value, to_value, *, actor=None, note=""):
    """A transition, written down as it happens.

    Returns None for a no-op move rather than writing "open → open", which would
    pad the history and skew duration-in-status.
    """
    if str(from_value) == str(to_value):
        return None
    return record(
        model, subject,
        kind=TimelineKind.STATUS,
        body=note,
        actor=actor,
        from_value=from_value,
        to_value=to_value,
    )


def timeline_for(model, subject, *, include_internal=True):
    """A subject's history, newest first.

    `include_internal=False` is what a customer-facing view passes. A parameter
    rather than a separate function, so that forgetting it is a visible omission
    at the call site rather than a silently over-sharing query.
    """
    entries = model.objects.filter(
        content_type=ContentType.objects.get_for_model(subject),
        object_id=subject.pk,
    )
    if not include_internal:
        entries = entries.filter(visibility=TimelineVisibility.CUSTOMER)
    return entries


def duration_in_current_status(model, subject):
    """How long this has sat where it is.

    The number both surfaces need and neither can get from `updated_at`: a
    ticket answered yesterday and one untouched for a week look identical by
    modification time. None when nothing has moved yet.
    """
    latest = (
        model.objects.filter(
            content_type=ContentType.objects.get_for_model(subject),
            object_id=subject.pk,
            kind=TimelineKind.STATUS,
        )
        .order_by("-created_at")
        .first()
    )
    if latest is None:
        return None
    return timezone.now() - latest.created_at
