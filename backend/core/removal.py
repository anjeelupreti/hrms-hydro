"""Removal that explains itself.

Implements the second half of the reversibility rule (docs/development-plan.md §2.7):
anything you can add, you must be able to take back — *unless* the row has
become binding, in which case the refusal has to say so.

Django already stops the dangerous deletes: reference a row with
``on_delete=PROTECT`` and the database refuses. But an unhandled `ProtectedError`
surfaces as a **500**, which reads as "the app is broken" when the truth is
"this leave type is used by 40 requests". Same information, opposite message.
"""

from django.db.models import ProtectedError
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response


def _describe_blockers(exc: ProtectedError) -> str:
    """Turn the protected objects into something a person can act on.

    `exc.protected_objects` is a set of model instances, so the useful summary
    is per-model counts — "used by 40 leave requests" tells you what to go and
    look at; a list of 40 primary keys does not.
    """
    counts: dict[str, int] = {}
    for obj in exc.protected_objects:
        label = obj._meta.verbose_name_plural if hasattr(obj, "_meta") else "records"
        counts[str(label)] = counts.get(str(label), 0) + 1

    if not counts:
        return "other records depend on it"

    return ", ".join(f"{count} {label}" for label, count in sorted(counts.items()))


class SafeDestroyMixin:
    """`DELETE` that refuses with a reason instead of a 500.

    Add to any viewset over a model other rows point at with `PROTECT`. If the
    model also has an `is_active` flag, this exposes `deactivate`/`reactivate`
    so there is still a way to take a wrong entry out of circulation — which is
    the point: "you cannot delete this" is only acceptable when paired with
    "…but here is what you can do instead".
    """

    #: Set on the viewset to name the thing in the message ("leave type").
    removal_label = "record"

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        has_flag = hasattr(instance, "is_active")
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError as exc:
            hint = (
                " Deactivate it instead to stop it being offered on new records,"
                " which keeps the history intact."
                if has_flag
                else ""
            )
            return Response(
                {
                    "detail": (
                        f"This {self.removal_label} is in use by "
                        f"{_describe_blockers(exc)}, so deleting it would take "
                        f"those records with it.{hint}"
                    )
                },
                # 409: the request is valid, it conflicts with current state.
                status=status.HTTP_409_CONFLICT,
            )

    @action(detail=True, methods=["post"])
    def deactivate(self, request, *args, **kwargs):
        """Retire without deleting — the removal for rows that carry history."""
        instance = self.get_object()
        if not hasattr(instance, "is_active"):
            return Response(
                {"detail": f"This {self.removal_label} cannot be deactivated."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        instance.is_active = False
        instance.updated_by = getattr(request, "user", None)
        instance.save(update_fields=["is_active", "updated_by", "updated_at"])
        return Response(self.get_serializer(instance).data)

    @action(detail=True, methods=["post"])
    def reactivate(self, request, *args, **kwargs):
        """Deactivation is itself reversible — it is a state, not a tombstone."""
        instance = self.get_object()
        if not hasattr(instance, "is_active"):
            return Response(
                {"detail": f"This {self.removal_label} cannot be reactivated."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        instance.is_active = True
        instance.updated_by = getattr(request, "user", None)
        instance.save(update_fields=["is_active", "updated_by", "updated_at"])
        return Response(self.get_serializer(instance).data)
