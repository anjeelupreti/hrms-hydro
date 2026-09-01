from django.db.models import Q
from django_filters import rest_framework as django_filters
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from accounts.policy import Perm, can
from attendance.permissions import _requesting_employee
from core.viewsets import AuditViewSetMixin
from goals.models import Objective
from goals.serializers import ObjectiveSerializer
from core.archiving import ArchiveMixin


def _is_hr(user):
    """Thin adapter over the one policy (accounts/policy.py).

    Kept as a local name so every call site in this file reads the same
    as it did; what it *means* is now decided in one place rather than
    re-derived here.
    """
    return can(user, Perm.WORKPLACE_MANAGE)


class ObjectiveViewSet(ArchiveMixin, AuditViewSetMixin, ModelViewSet):
    serializer_class = ObjectiveSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [django_filters.DjangoFilterBackend]
    filterset_fields = ["owner", "status"]

    def get_queryset(self):
        qs = Objective.objects.select_related("owner__user").prefetch_related("key_results")
        if _is_hr(self.request.user):
            return qs
        me = _requesting_employee(self.request.user)
        # Everyone sees company objectives (owner null) + their own.
        cond = Q(owner__isnull=True)
        if me is not None:
            cond |= Q(owner=me)
        return qs.filter(cond)

    def create(self, request, *args, **kwargs):
        me = _requesting_employee(request.user)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        owner = serializer.validated_data.get("owner", None)
        if not _is_hr(request.user):
            # Non-HR may only create an objective for themselves.
            if me is None:
                return Response({"detail": "Your account has no employee profile."}, status=400)
            if owner is not None and owner != me:
                return Response({"detail": "You can only set goals for yourself."}, status=403)
            serializer.validated_data["owner"] = me
        obj = serializer.save(created_by=request.user, updated_by=request.user)
        return Response(self.get_serializer(obj).data, status=status.HTTP_201_CREATED)

    def _may_edit(self, request, objective):
        if _is_hr(request.user):
            return True
        me = _requesting_employee(request.user)
        return me is not None and objective.owner_id == me.id

    def update(self, request, *args, **kwargs):
        if not self._may_edit(request, self.get_object()):
            return Response(status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not self._may_edit(request, self.get_object()):
            return Response(status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def checkin(self, request, *args, **kwargs):
        """Update one key result's current value (a progress check-in)."""
        objective = self.get_object()
        if not self._may_edit(request, objective):
            return Response(status=status.HTTP_403_FORBIDDEN)
        kr = objective.key_results.filter(pk=request.data.get("key_result")).first()
        if kr is None:
            return Response({"detail": "Key result not found."}, status=404)
        if "current_value" not in request.data:
            return Response({"detail": "current_value required."}, status=400)
        kr.current_value = request.data["current_value"]
        kr.updated_by = request.user
        kr.save(update_fields=["current_value", "updated_by"])
        # Re-fetch: the objective's key_results were prefetched before the
        # save, so serializing `objective` directly would read stale progress.
        fresh = self.get_queryset().get(pk=objective.pk)
        return Response(self.get_serializer(fresh).data)
