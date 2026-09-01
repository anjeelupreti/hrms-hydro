from zoneinfo import ZoneInfo

from django.core.mail.backends.smtp import EmailBackend as SMTPEmailBackend
from django.db.models import Q
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from accounts.permissions import IsHRAdminOrReadOnly
from accounts.policy import Perm, can
from attendance.permissions import _requesting_employee
from core.calendars import UnsupportedDateError, get_calendar
from core.viewsets import AuditViewSetMixin
from organization import services
from organization.models import CompanyProfile, Review, ReviewCycle, CompanyEmailSettings
from organization.serializers import (
    CompanyProfileSerializer,
    EmailConnectionTestSerializer,
    ImapConnectionTestSerializer,
    ManagerAssessmentSerializer,
    ReviewCycleSerializer,
    ReviewSerializer,
    SelfAssessmentSerializer,
    CompanyEmailSettingsSerializer,
)


class TodayView(APIView):
    """Today, in every calendar the company cares about.

    **Why the server renders this.** The Bikram Sambat conversion is a lookup
    table (see `core.calendars`), and a second copy of it in TypeScript is a
    second thing that can disagree with the first — on a date that appears in
    the top bar of every page. The browser gets a formatted string and a live
    clock; it does no date arithmetic.

    Cheap enough to be called on page load: two table lookups and no query. The
    date changes at most once a day, so the client caches it for the rest of the
    session rather than re-asking on every navigation.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        profile = CompanyProfile.get_solo()
        tz = ZoneInfo(profile.timezone or "UTC")
        # The company's today, not the server's. A server in UTC is on the
        # previous day for most of Nepal's working morning.
        today = timezone.now().astimezone(tz).date()

        gregorian = get_calendar("AD")
        nepali = get_calendar("BS")

        payload = {
            "timezone": profile.timezone,
            "gregorian": {
                "date": today.isoformat(),
                # Built rather than strftime'd: "%-d" (no zero pad) is
                # glibc-only and raises on Windows, where this also runs.
                "label": f"{today:%A}, {today.day} {today:%B} {today.year}",
                "fiscal_year": gregorian.fiscal_year_label(gregorian.fiscal_year_of(today)),
            },
        }

        # Nepali is best-effort: a date outside the conversion table must not
        # take the whole top bar down with it.
        try:
            bs_date = nepali.from_gregorian(today)
            fy = nepali.fiscal_year_of(today)
            payload["nepali"] = {
                "date": str(bs_date),
                "label": nepali.format_np(today),
                "fiscal_year": nepali.fiscal_year_label(fy),
                "fiscal_year_np": nepali.to_devanagari(nepali.fiscal_year_label(fy)),
            }
        except UnsupportedDateError:
            payload["nepali"] = None

        return Response(payload)


class CompanyProfileView(APIView):
    """Singleton — no list/detail routes, just GET/PATCH "the" profile."""

    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        return Response(CompanyProfileSerializer(CompanyProfile.get_solo()).data)

    def patch(self, request, *args, **kwargs):
        if not can(request.user, Perm.SETTINGS_MANAGE):
            return Response(status=status.HTTP_403_FORBIDDEN)
        profile = CompanyProfile.get_solo()
        serializer = CompanyProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        return Response(serializer.data)


class CompanyEmailSettingsView(APIView):
    """Singleton, HR-only in both directions — even reading SMTP host/
    username (let alone whether a password is set) is sensitive."""

    permission_classes = [IsAuthenticated]

    def _require_hr(self, request):
        return can(request.user, Perm.SETTINGS_MANAGE)

    def get(self, request, *args, **kwargs):
        if not self._require_hr(request):
            return Response(status=status.HTTP_403_FORBIDDEN)
        return Response(CompanyEmailSettingsSerializer(CompanyEmailSettings.get_solo()).data)

    def patch(self, request, *args, **kwargs):
        if not self._require_hr(request):
            return Response(status=status.HTTP_403_FORBIDDEN)
        settings_obj = CompanyEmailSettings.get_solo()
        serializer = CompanyEmailSettingsSerializer(settings_obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        return Response(serializer.data)


class EmailConnectionTestView(APIView):
    """Plain APIView (not a ViewSet action) — tests candidate SMTP
    settings *before* they're saved, so HR finds out immediately if
    credentials are wrong rather than silently breaking every outgoing
    email the next time something tries to send."""

    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        if not can(request.user, Perm.SETTINGS_MANAGE):
            return Response(status=status.HTTP_403_FORBIDDEN)
        serializer = EmailConnectionTestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            backend = SMTPEmailBackend(
                host=data["host"],
                port=data["port"],
                username=data["username"],
                password=data["password"],
                use_tls=data["use_tls"],
                fail_silently=False,
            )
            backend.open()
            backend.close()
        except Exception as exc:
            return Response({"detail": f"Connection failed: {exc}"}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": "Connection successful."})


class ImapConnectionTestView(APIView):
    """IMAP counterpart of EmailConnectionTestView — verifies the inbox
    credentials before saving. A blank password means 'reuse the one
    already stored' (the UI never re-sends the saved password)."""

    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        if not can(request.user, Perm.SETTINGS_MANAGE):
            return Response(status=status.HTTP_403_FORBIDDEN)
        serializer = ImapConnectionTestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        password = data.get("password") or CompanyEmailSettings.get_solo().get_password()
        from mail.services import test_imap_connection

        try:
            test_imap_connection(
                host=data["imap_host"],
                port=data["imap_port"],
                username=data["username"],
                password=password,
                use_ssl=data["imap_use_ssl"],
            )
        except Exception as exc:
            return Response({"detail": f"Connection failed: {exc}"}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": "Connection successful."})


class ReviewCycleViewSet(AuditViewSetMixin, ModelViewSet):
    http_method_names = ["get", "post", "head", "options"]
    queryset = ReviewCycle.objects.all()
    serializer_class = ReviewCycleSerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]

    @action(detail=True, methods=["post"])
    def start(self, request, *args, **kwargs):
        cycle = self.get_object()
        if cycle.status != ReviewCycle.Status.DRAFT:
            return Response(
                {"detail": "Only a draft cycle can be started."}, status=status.HTTP_400_BAD_REQUEST
            )
        created = services.start_cycle(cycle)
        return Response({"detail": f"Cycle started, {created} review(s) created."})


class ReviewViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    """No create/destroy — Reviews only ever come from
    ReviewCycleViewSet.start(). Employees/managers only ever update via
    the submit-self/submit-manager actions, never a raw PATCH."""

    serializer_class = ReviewSerializer
    permission_classes = [IsAuthenticated]
    #: `useReviews({ cycle })` sends this. Without it the parameter is accepted
    #: and ignored, so a cycle selector would narrow nothing while looking as
    #: though it had — the list would still show every cycle's reviews.
    filterset_fields = ["cycle", "status"]
    # `SearchFilter` named explicitly — DEFAULT_FILTER_BACKENDS is
    # DjangoFilterBackend alone, so `search_fields` on its own does nothing.
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    # A review is looked for by whose it is, or by the cycle it belongs to.
    search_fields = [
        "employee__user__first_name",
        "employee__user__last_name",
        "employee__employee_code",
        "cycle__name",
    ]

    def get_queryset(self):
        qs = Review.objects.select_related("cycle", "employee__user", "reviewer__user")
        user = self.request.user
        if can(user, Perm.SETTINGS_MANAGE):
            return qs
        employee = _requesting_employee(user)
        if employee is None:
            return qs.none()
        return qs.filter(Q(employee=employee) | Q(reviewer=employee))

    @action(detail=True, methods=["post"], url_path="submit-self")
    def submit_self(self, request, *args, **kwargs):
        review = self.get_object()
        employee = _requesting_employee(request.user)
        if employee is None or review.employee_id != employee.id:
            return Response(status=status.HTTP_403_FORBIDDEN)
        if review.status != Review.Status.PENDING_SELF:
            return Response(
                {"detail": "Self-assessment has already been submitted."}, status=status.HTTP_400_BAD_REQUEST
            )
        serializer = SelfAssessmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        review = services.submit_self_assessment(
            review, serializer.validated_data["self_assessment"], serializer.validated_data["self_rating"]
        )
        return Response(ReviewSerializer(review).data)

    @action(detail=True, methods=["post"], url_path="submit-manager")
    def submit_manager(self, request, *args, **kwargs):
        review = self.get_object()
        employee = _requesting_employee(request.user)
        is_reviewer = employee is not None and review.reviewer_id == employee.id
        is_hr = can(request.user, Perm.SETTINGS_MANAGE)
        if not (is_reviewer or is_hr):
            return Response(status=status.HTTP_403_FORBIDDEN)
        if review.status != Review.Status.PENDING_MANAGER:
            return Response(
                {"detail": "This review isn't awaiting a manager assessment."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = ManagerAssessmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        review = services.submit_manager_assessment(
            review,
            request.user,
            serializer.validated_data["manager_assessment"],
            serializer.validated_data["manager_rating"],
        )
        return Response(ReviewSerializer(review).data)


class SetupReadinessView(APIView):
    """What this workspace still has to configure, resolved live.

    **Readable by anybody signed in; changeable only by somebody who can change
    settings.** An employee seeing that payroll is not configured yet is not a
    disclosure — they are going to notice when their payslip does not arrive —
    and hiding it means the one person who could mention it to HR cannot.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        from organization.setup import readiness

        return Response(readiness())

    def post(self, request, *args, **kwargs):
        """Skip a check, with a reason — or undo a skip.

        `{"key": "...", "reason": "..."}` skips; `{"key": "...", "skip": false}`
        undoes it.
        """
        from organization.models import SetupSkip
        from organization.setup import CHECKS_BY_KEY, readiness

        if not can(request.user, Perm.SETTINGS_MANAGE):
            return Response(status=status.HTTP_403_FORBIDDEN)

        key = request.data.get("key")
        check = CHECKS_BY_KEY.get(key)
        if check is None:
            return Response(
                {"key": "No such setup check."}, status=status.HTTP_400_BAD_REQUEST
            )

        if request.data.get("skip") is False:
            SetupSkip.objects.filter(check_key=key).delete()
            return Response(readiness())

        # 🔒 Guarded in the service, not by hiding the button. A must-have that
        # can be waved through by a hand-written request is a recommendation
        # wearing a badge, and the tier is the whole promise of this screen.
        if not check.skippable:
            return Response(
                {
                    "detail": (
                        f"“{check.title}” has to be done — nobody can be paid correctly "
                        "without it, so it cannot be skipped."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        reason = (request.data.get("reason") or "").strip()
        if not reason:
            # A skip with no reason is indistinguishable from an oversight three
            # months later, and whoever has to decide whether to undo it is
            # usually not whoever did it.
            return Response(
                {"reason": "Say why you are skipping this."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        SetupSkip.objects.update_or_create(
            check_key=key,
            defaults={"reason": reason[:255], "updated_by": request.user},
        )
        return Response(readiness())
