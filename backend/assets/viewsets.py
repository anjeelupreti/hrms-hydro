from django.utils import timezone
from django_filters import rest_framework as django_filters
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from accounts.policy import Perm, can
from assets.history import record
from assets.models import Asset, AssetAssignment, AssetEvent, AssetPhoto
from assets.serializers import (
    AssetEventSerializer,
    AssetAssignmentSerializer,
    AssetPhotoSerializer,
    AssetSerializer,
)
from attendance.permissions import _requesting_employee
from core.counts import StatusCountsMixin
from core.viewsets import AuditViewSetMixin


def _is_hr(user):
    """Thin adapter over the one policy (accounts/policy.py).

    Kept as a local name so every call site in this file reads the same
    as it did; what it *means* is now decided in one place rather than
    re-derived here.
    """
    return can(user, Perm.WORKPLACE_MANAGE)


class AssetViewSet(StatusCountsMixin, AuditViewSetMixin, ModelViewSet):
    """Company assets. Readable by any authenticated user; create/edit/assign/
    return are HR-only. Assignment history is kept for offboarding/audit."""

    serializer_class = AssetSerializer
    permission_classes = [IsAuthenticated]
    # `SearchFilter` is named explicitly because the project's
    # DEFAULT_FILTER_BACKENDS is DjangoFilterBackend alone: `search_fields`
    # without it is silently inert.
    filter_backends = [django_filters.DjangoFilterBackend, filters.SearchFilter]
    # Found by tag, serial or the thing's name — how somebody actually looks for kit.
    search_fields = ["name", "asset_tag", "serial_number", "notes", "assigned_to__user__first_name", "assigned_to__user__last_name"]
    filterset_fields = ["category", "status", "assigned_to"]

    def get_queryset(self):
        # `photos` is prefetched for the cover thumbnail on every row — without
        # it the list costs one extra query per asset to answer "is there a
        # picture of this".
        return Asset.objects.select_related("assigned_to__user").prefetch_related("photos")

    def _deny_if_not_hr(self, request):
        return None if _is_hr(request.user) else Response({"detail": "HR only."}, status=status.HTTP_403_FORBIDDEN)

    def create(self, request, *a, **k):
        return self._deny_if_not_hr(request) or super().create(request, *a, **k)

    def update(self, request, *a, **k):
        return self._deny_if_not_hr(request) or super().update(request, *a, **k)

    def destroy(self, request, *a, **k):
        return self._deny_if_not_hr(request) or super().destroy(request, *a, **k)

    @action(detail=True, methods=["post"])
    def assign(self, request, *args, **kwargs):
        deny = self._deny_if_not_hr(request)
        if deny:
            return deny
        asset = self.get_object()
        if asset.assignments.filter(returned_at__isnull=True).exists():
            return Response({"detail": "Asset is already assigned — return it first."}, status=400)
        from employees.models import Employee

        employee = Employee.objects.filter(pk=request.data.get("employee")).first()
        if employee is None:
            return Response({"detail": "Employee not found."}, status=400)
        assigned_at = request.data.get("assigned_at") or timezone.localdate()
        AssetAssignment.objects.create(
            asset=asset,
            employee=employee,
            assigned_at=assigned_at,
            note=request.data.get("note", ""),
            created_by=request.user,
            updated_by=request.user,
        )
        previous_status = asset.status
        asset.assigned_to = employee
        asset.status = Asset.Status.ASSIGNED
        asset.save(update_fields=["assigned_to", "status"])
        # Recorded here rather than reconstructed from the assignment table
        # later: the history has to be able to say who held it *at the time*,
        # and a row that is later closed and reopened loses that.
        record(
            asset,
            AssetEvent.Kind.ASSIGNED,
            actor=request.user,
            custodian=employee,
            from_value=previous_status,
            to_value=asset.status,
            note=request.data.get("note", ""),
            on=assigned_at,
        )
        return Response(self.get_serializer(asset).data)

    @action(detail=True, methods=["post"], url_path="return")
    def return_asset(self, request, *args, **kwargs):
        deny = self._deny_if_not_hr(request)
        if deny:
            return deny
        asset = self.get_object()
        open_assignment = asset.assignments.filter(returned_at__isnull=True).first()
        if open_assignment is None:
            return Response({"detail": "Asset isn't currently assigned."}, status=400)
        returned_at = request.data.get("returned_at") or timezone.localdate()
        open_assignment.returned_at = returned_at
        open_assignment.updated_by = request.user
        open_assignment.save(update_fields=["returned_at", "updated_by"])
        holder = asset.assigned_to
        previous_status = asset.status
        asset.assigned_to = None
        asset.status = Asset.Status.AVAILABLE
        asset.save(update_fields=["assigned_to", "status"])
        record(
            asset,
            AssetEvent.Kind.RETURNED,
            actor=request.user,
            custodian=holder,
            from_value=previous_status,
            to_value=asset.status,
            note=request.data.get("note", ""),
            on=returned_at,
        )
        return Response(self.get_serializer(asset).data)

    @action(detail=True, methods=["get"])
    def assignments(self, request, *args, **kwargs):
        asset = self.get_object()
        qs = asset.assignments.select_related("employee__user")
        return Response(AssetAssignmentSerializer(qs, many=True).data)

    @action(detail=True, methods=["get", "post"])
    def history(self, request, *args, **kwargs):
        """Everything that has happened to this asset.

        `GET` returns the log. `POST` adds an entry by hand, which is what
        records the things no button covers — sent for repair, came back with a
        cracked case, written off after a flood at the powerhouse.
        """
        asset = self.get_object()
        if request.method == "GET":
            events = asset.events.select_related("custodian__user", "actor")
            return Response(AssetEventSerializer(events, many=True).data)

        deny = self._deny_if_not_hr(request)
        if deny:
            return deny

        kind = request.data.get("kind") or AssetEvent.Kind.NOTE
        if kind not in AssetEvent.Kind.values:
            return Response({"detail": f"No such kind: {kind}."}, status=400)

        # A maintenance or retirement entry moves the asset's own status too.
        # Recording one without the other is how the register comes to say
        # "available" about a laptop that is in a repair shop.
        moves_status = {
            AssetEvent.Kind.MAINTENANCE: Asset.Status.MAINTENANCE,
            AssetEvent.Kind.REPAIRED: Asset.Status.ASSIGNED
            if asset.assigned_to
            else Asset.Status.AVAILABLE,
            AssetEvent.Kind.RETIRED: Asset.Status.RETIRED,
            AssetEvent.Kind.LOST: Asset.Status.RETIRED,
        }
        previous_status = asset.status
        new_status = moves_status.get(kind)
        if new_status and new_status != previous_status:
            asset.status = new_status
            asset.save(update_fields=["status"])

        event = record(
            asset,
            kind,
            actor=request.user,
            custodian=asset.assigned_to,
            from_value=previous_status if new_status else "",
            to_value=asset.status if new_status else "",
            note=request.data.get("note", ""),
            on=request.data.get("occurred_on") or None,
        )
        return Response(AssetEventSerializer(event).data, status=201)

    @action(detail=False, methods=["get"])
    def mine(self, request, *args, **kwargs):
        me = _requesting_employee(request.user)
        qs = Asset.objects.none() if me is None else Asset.objects.filter(assigned_to=me)
        return Response(self.get_serializer(qs, many=True).data)


class AssetPhotoViewSet(AuditViewSetMixin, ModelViewSet):
    """Pictures of an asset.

    **Read by anyone signed in, written by HR only** — the same split the asset
    itself has. A photo is evidence about company property, and letting the
    holder of a laptop add to or remove from its record would defeat the reason
    the pictures are taken (see `AssetPhoto`).

    No update route in practice: a photograph is not edited, it is added or
    withdrawn. `caption` is the exception and goes through `PATCH` like any
    other field.
    """

    serializer_class = AssetPhotoSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]
    filter_backends = [django_filters.DjangoFilterBackend]
    filterset_fields = ["asset"]

    def get_queryset(self):
        return AssetPhoto.objects.select_related("asset", "created_by")

    def _deny_if_not_hr(self, request):
        return (
            None
            if _is_hr(request.user)
            else Response({"detail": "HR only."}, status=status.HTTP_403_FORBIDDEN)
        )

    def create(self, request, *a, **k):
        return self._deny_if_not_hr(request) or super().create(request, *a, **k)

    def update(self, request, *a, **k):
        return self._deny_if_not_hr(request) or super().update(request, *a, **k)

    def partial_update(self, request, *a, **k):
        return self._deny_if_not_hr(request) or super().partial_update(request, *a, **k)

    def destroy(self, request, *a, **k):
        return self._deny_if_not_hr(request) or super().destroy(request, *a, **k)
