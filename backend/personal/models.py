from django.conf import settings
from django.db import models

from core.models import AuditModel


class Todo(AuditModel):
    """A private checklist item. Not a task, and deliberately not one.

    **A to-do is not a `ProjectTask` with the project left blank.** A task has an
    assignee, a board column, a milestone and an audience — it is work the
    organisation is tracking, and somebody else can see it, move it, or ask about
    it. This is the note-to-self a person keeps beside that: *ring the bank*,
    *chase Sita about the invoice*, *bring the laptop charger*. Modelling the
    second as the first would either publish it to a board or leave a permanent
    column of orphan tasks nobody can close.

    So the owner is the whole permission model. There is no assignee, because a
    to-do you can give to somebody else is a task; there is no status workflow,
    because the only states a personal list needs are done and not done.
    """

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="todos",
    )
    title = models.CharField(max_length=300)
    notes = models.TextField(blank=True)
    due_date = models.DateField(null=True, blank=True)
    done_at = models.DateTimeField(null=True, blank=True)
    # Archive rather than delete is the default gesture: a finished list is a
    # record of a week, and the only way to keep the live list short without
    # destroying that is to move things out of it. Delete stays available.
    archived_at = models.DateTimeField(null=True, blank=True)
    # Manual position within the live list. A personal list has no objective
    # sort — "what I want to do first" is the whole point of ordering it.
    #
    # Signed, and it has to be: a new item is placed at `min(order) - 1` so it
    # lands at the top without rewriting every other row, and `PositiveInteger`
    # made that a check-constraint violation on the very first to-do anybody
    # wrote. The alternative — shifting the whole list down on every insert —
    # is a write per row to avoid storing a minus sign.
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ["order", "-created_at"]
        indexes = [
            # The list view is always "mine, not archived", so index the pair
            # rather than the owner alone.
            models.Index(fields=["owner", "archived_at"]),
        ]

    @property
    def is_done(self):
        return self.done_at is not None

    def __str__(self):
        return self.title
