from django_filters import rest_framework as django_filters
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from accounts.policy import Perm, can
from attendance.permissions import _requesting_employee
from core.viewsets import AuditViewSetMixin
from fieldvisits import services
from fieldvisits.models import FieldVisit, Site
from fieldvisits.serializers import (
    FieldVisitAttachmentSerializer,
    FieldVisitParticipantSerializer,
    EligibleApproverSerializer,
    FieldVisitSerializer,
    SiteSerializer,
)
from fieldvisits.services import FieldVisitError


class FieldVisitFilterSet(django_filters.FilterSet):
    #: Visits covering a day — what the roster asks when somebody is missing.
    on_date = django_filters.DateFilter(method="filter_on_date")
    mine = django_filters.BooleanFilter(method="filter_mine")

    class Meta:
        model = FieldVisit
        fields = ["employee", "status", "purpose", "company", "project"]

    def filter_on_date(self, queryset, name, value):
        return queryset.filter(starts_on__lte=value, ends_on__gte=value)

    def filter_mine(self, queryset, name, value):
        me = _requesting_employee(self.request.user)
        if not value or me is None:
            return queryset
        return queryset.filter(employee=me)


class FieldVisitViewSet(AuditViewSetMixin, ModelViewSet):
    """Going to site: the request, the travel order, and the report.

    **Visible to the traveller, their manager, and anybody who manages
    attendance.** A field visit is why somebody is not at their desk, so it is
    not private in the way an expense claim is — a supervisor looking for a
    missing engineer needs to find the answer without asking HR.

    Every transition goes through `fieldvisits.services`, which owns the seam
    with attendance: an approved visit is what stops the nightly sweep marking
    somebody absent for being where they were sent.
    """

    serializer_class = FieldVisitSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_class = FieldVisitFilterSet
    search_fields = ["title", "destination", "district", "description", "report"]
    ordering_fields = ["starts_on", "ends_on", "status"]
    ordering = ["-starts_on"]

    def _me(self):
        return _requesting_employee(self.request.user)

    def get_queryset(self):
        queryset = FieldVisit.objects.select_related(
            "employee__user", "approver__user", "company", "project"
        ).prefetch_related("participants__employee__user", "attachments")
        if can(self.request.user, Perm.ATTENDANCE_MANAGE) or can(self.request.user, Perm.PEOPLE_MANAGE):
            return queryset
        me = self._me()
        if me is None:
            return queryset.none()
        # Their own, the ones they approve, and their team's — the same reach a
        # manager has everywhere else.
        return queryset.filter(
            models_q(me)
        ).distinct()

    def perform_create(self, serializer):
        me = self._me()
        if me is None:
            raise FieldVisitError("Your account has no employee record to travel against.")
        serializer.save(
            employee=me, created_by=self.request.user, updated_by=self.request.user
        )

    def handle_exception(self, exc):
        """The same rule as the transitions, for the paths `_run` does not
        cover: a `FieldVisitError` is a refusal with a sentence in it, not a
        server fault."""
        if isinstance(exc, FieldVisitError):
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return super().handle_exception(exc)

    def _run(self, fn, *args, **kwargs):
        try:
            visit = fn(*args, **kwargs)
        except FieldVisitError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        visit.refresh_from_db()
        return Response(self.get_serializer(visit).data)

    def destroy(self, request, *args, **kwargs):
        """Only an abandoned draft, and only the traveller's own.

        There was no guard here at all, which meant a **completed** visit could
        be deleted — and a completed visit is not a plan, it is a record. It
        carries the report, it may have written timesheet lines against a
        project, and it may have an expense claim hanging off it. Removing the
        row leaves those either orphaned or silently wrong, and the day anybody
        notices is the day somebody queries a payment.

        A draft nobody sent is the one case where deleting costs nothing, which
        is why it is the only one allowed. Anything further along is cancelled
        instead — that keeps the trail.
        """
        visit = self.get_object()
        me = self._me()
        if visit.status != FieldVisit.Status.DRAFT:
            return Response(
                {
                    "detail": (
                        f"This visit has been {visit.get_status_display().lower()}, so it "
                        "is part of the record now — it may carry a report, timesheet "
                        "lines and an expense claim. Cancel it instead."
                    ),
                    "code": "not_a_draft",
                },
                status=status.HTTP_409_CONFLICT,
            )
        if visit.employee_id != getattr(me, "pk", None) and not can(
            request.user, Perm.ATTENDANCE_MANAGE
        ):
            return Response(
                {"detail": "Only the traveller can delete their own draft."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def request_order(self, request, *args, **kwargs):
        visit = self.get_object()
        if visit.employee_id != getattr(self._me(), "pk", None):
            return Response(
                {"detail": "Only the traveller requests their own visit."},
                status=status.HTTP_403_FORBIDDEN,
            )
        # **Checked here, not only on the form.** A travel order with nobody
        # named on it lands in a queue nobody owns, and the rule about *who*
        # may be named — the site's supervisors or their own — is the whole
        # reason sites carry supervisors at all.
        try:
            services.validate_approver(visit.employee, visit.site, visit.approver)
        except services.FieldVisitError as error:
            return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)
        return self._run(services.request_visit, visit, actor=request.user)

    @action(detail=False, methods=["get"], url_path="eligible-approvers")
    def eligible_approvers(self, request, *args, **kwargs):
        """Who the signed-in person may ask to approve a trip.

        Takes an optional `?site=` — a site adds its own supervisors to the
        requester's. Answered by the server rather than assembled in the
        browser: the same list is what `request_order` validates against, and
        two copies of that rule is how a form offers somebody the API refuses.
        """
        me = self._me()
        if me is None:
            return Response([])
        site = None
        site_id = request.query_params.get("site")
        if site_id:
            site = Site.objects.filter(pk=site_id).first()
        people = services.eligible_approvers(me, site)
        return Response(EligibleApproverSerializer(people, many=True).data)

    def _may_decide(self, visit):
        me = self._me()
        if me is not None and visit.approver_id == me.pk:
            return True
        return can(self.request.user, Perm.ATTENDANCE_MANAGE)

    @action(detail=True, methods=["post"])
    def approve(self, request, *args, **kwargs):
        visit = self.get_object()
        if not self._may_decide(visit):
            return Response(
                {"detail": "Only the named approver, or somebody who manages attendance."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return self._run(
            services.decide, visit, approve=True,
            note=request.data.get("note", ""), actor=request.user,
        )

    @action(detail=True, methods=["post"])
    def reject(self, request, *args, **kwargs):
        visit = self.get_object()
        if not self._may_decide(visit):
            return Response(status=status.HTTP_403_FORBIDDEN)
        return self._run(
            services.decide, visit, approve=False,
            note=request.data.get("note", ""), actor=request.user,
        )

    @action(detail=True, methods=["post"])
    def complete(self, request, *args, **kwargs):
        visit = self.get_object()
        if visit.employee_id != getattr(self._me(), "pk", None) and not can(
            request.user, Perm.ATTENDANCE_MANAGE
        ):
            return Response(status=status.HTTP_403_FORBIDDEN)
        return self._run(
            services.complete, visit, report=request.data.get("report", ""), actor=request.user
        )

    @action(detail=True, methods=["post"], url_path="generate-timesheet")
    def generate_timesheet(self, request, *args, **kwargs):
        """Turn a completed visit into timesheet lines.

        The honest half of "can timesheets carry field visits": they cannot
        hold one, but a visit can produce entries. See
        `fieldvisits.services.generate_time_entries`.
        """
        visit = self.get_object()
        try:
            created = services.generate_time_entries(
                visit,
                hours_per_day=request.data.get("hours_per_day", "8.00"),
                actor=request.user,
            )
        except FieldVisitError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"created": created, "days": visit.days})

    # ── Participants ─────────────────────────────────────────────────────

    @action(detail=True, methods=["get", "post"])
    def participants(self, request, *args, **kwargs):
        visit = self.get_object()
        if request.method == "GET":
            return Response(
                FieldVisitParticipantSerializer(visit.participants.all(), many=True).data
            )
        serializer = FieldVisitParticipantSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(visit=visit)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"participants/(?P<participant_id>[0-9]+)")
    def participant_detail(self, request, participant_id=None, *args, **kwargs):
        visit = self.get_object()
        row = visit.participants.filter(pk=participant_id).first()
        if row is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        row.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ── Attachments ──────────────────────────────────────────────────────

    @action(
        detail=True, methods=["get", "post"],
        parser_classes=[MultiPartParser, FormParser],
    )
    def attachments(self, request, *args, **kwargs):
        visit = self.get_object()
        if request.method == "GET":
            return Response(
                FieldVisitAttachmentSerializer(visit.attachments.all(), many=True).data
            )
        serializer = FieldVisitAttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(
            visit=visit, uploaded_by=request.user,
            created_by=request.user, updated_by=request.user,
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"attachments/(?P<attachment_id>[0-9]+)")
    def attachment_detail(self, request, attachment_id=None, *args, **kwargs):
        visit = self.get_object()
        row = visit.attachments.filter(pk=attachment_id).first()
        if row is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        row.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def models_q(me):
    """Their own visits, the ones they approve, and their team's.

    A function rather than an inline `Q` chain so the reach is stated once and
    reads as the sentence above.
    """
    from django.db.models import Q

    return Q(employee=me) | Q(approver=me) | Q(employee__manager=me) | Q(participants__employee=me)


class SiteViewSet(AuditViewSetMixin, ModelViewSet):
    """Sites: everybody reads, `workplace.manage` writes.

    **Read by everybody on purpose.** Anybody raising a travel order has to
    pick where they are going and which of its supervisors should approve it,
    so a site list only the coordinator can see would make the form
    unfillable.

    Retired rather than deleted — see `Site.is_active`. A site with ten years
    of visits behind it cannot be removed without taking the history with it,
    and "we do not go there any more" is not "it never existed", so `destroy`
    deactivates instead.
    """

    serializer_class = SiteSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_fields = ["company", "district", "is_active"]
    search_fields = ["name", "code", "district", "address"]
    ordering_fields = ["name", "code"]
    ordering = ["name"]

    def get_queryset(self):
        return Site.objects.select_related("company").prefetch_related("supervisors__user")

    def _may_write(self):
        return can(self.request.user, Perm.WORKPLACE_MANAGE)

    def create(self, request, *args, **kwargs):
        if not self._may_write():
            return Response(status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if not self._may_write():
            return Response(status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not self._may_write():
            return Response(status=status.HTTP_403_FORBIDDEN)
        site = self.get_object()
        site.is_active = False
        site.updated_by = request.user
        site.save(update_fields=["is_active", "updated_by", "updated_at"])
        return Response(SiteSerializer(site).data)


