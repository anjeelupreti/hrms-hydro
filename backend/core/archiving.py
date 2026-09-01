"""Filing away what is finished.

**Archiving is not deactivating, and the difference is the point.**
`core.removal` already retires *definitions* — a leave type nobody should pick
any more, a shift that is no longer run. That is `is_active`, and it answers
"may this still be used?".

Archiving answers a different question about a different kind of row: **"is this
still my business today?"** A completed onboarding checklist, last Dashain's
announcement, a survey that closed in March — none of them are inactive, wrong
or deletable. They happened, they are finished, and they are cluttering the list
of things that have not.

Conflating the two would be the usual mistake: `is_active = False` on a finished
checklist would read as "this checklist was cancelled", which is a different
fact about the same row and the one somebody would be misled by a year later.

**Reversible, per §2.7.** Archiving is a state, not a tombstone — everything
here has a matching restore, because the whole reason to archive rather than
delete is that you might have been wrong about it being over.

**Who and when are recorded.** "Why is this not in my list?" is answered by
"Sushma archived it on 12 Bhadra", and cannot be answered by a boolean.
"""

from django.db import models
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.response import Response


class ArchivableModel(models.Model):
    """Adds the archive stamp. Mix into a model whose rows *finish*."""

    #: Null while live. The timestamp is the flag — a separate boolean would be
    #: a second source of truth that can disagree with it.
    archived_at = models.DateTimeField(null=True, blank=True, db_index=True)
    archived_by = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    class Meta:
        abstract = True

    @property
    def is_archived(self):
        return self.archived_at is not None

    def archive(self, actor=None):
        if self.archived_at is not None:
            return self
        self.archived_at = timezone.now()
        self.archived_by = actor
        self.save(update_fields=["archived_at", "archived_by"])
        return self

    def unarchive(self):
        if self.archived_at is None:
            return self
        self.archived_at = None
        self.archived_by = None
        self.save(update_fields=["archived_at", "archived_by"])
        return self


class ArchiveMixin:
    """`POST …/archive` and `…/unarchive`, plus a list that hides the archive.

    **Hidden by default, never silently.** A list that quietly dropped rows
    would leave somebody hunting for a checklist that is sitting in the archive.
    So the default is live-only and `?archived=1` shows the archive — the same
    shape as every other filter on these screens, and the count endpoints keep
    reporting both.
    """

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)

        # The list only. DRF's `get_object()` runs the detail lookup through
        # `filter_queryset` too, so hiding archived rows unconditionally would
        # hide them from `unarchive` as well — and restoring something would
        # 404 on the one row the action exists to reach.
        if getattr(self, "action", None) != "list":
            return queryset

        wanted = str(self.request.query_params.get("archived", "")).lower()
        if wanted in ("1", "true", "yes"):
            return queryset.filter(archived_at__isnull=False)
        if wanted in ("all", "any"):
            return queryset
        return queryset.filter(archived_at__isnull=True)

    @action(detail=True, methods=["post"])
    def archive(self, request, *args, **kwargs):
        """File this away. It stays readable; it stops being in the way."""
        instance = self.get_object()
        instance.archive(actor=getattr(request, "user", None))
        return Response(self.get_serializer(instance).data)

    @action(detail=True, methods=["post"])
    def unarchive(self, request, *args, **kwargs):
        """Bring it back. Archiving is a state, not a tombstone."""
        instance = self.get_object()
        instance.unarchive()
        return Response(self.get_serializer(instance).data)
