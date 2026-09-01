from django.http import FileResponse, Http404
from django_filters import rest_framework as django_filters
from rest_framework import filters, mixins, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from accounts.permissions import IsHRAdminOrReadOnly
from accounts.policy import Perm, can
from core.exports import XlsxExportMixin
from core.viewsets import AuditViewSetMixin
from documents.models import Document
from documents.services import latest_document_for
from employees.models import Employee
from training import services
from training.models import Enrollment, TrainingProgram, TrainingSession
from training.serializers import (
    CompleteEnrollmentSerializer,
    EnrollmentSerializer,
    TrainingProgramSerializer,
    TrainingSessionSerializer,
)
from core.archiving import ArchiveMixin


def _is_hr(user):
    """Thin adapter over the one policy (accounts/policy.py).

    Kept as a local name so every call site in this file reads the same
    as it did; what it *means* is now decided in one place rather than
    re-derived here.
    """
    return can(user, Perm.WORKPLACE_MANAGE)


class TrainingProgramViewSet(AuditViewSetMixin, ModelViewSet):
    queryset = TrainingProgram.objects.all()
    serializer_class = TrainingProgramSerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]
    # `SearchFilter` is named explicitly because the project's
    # DEFAULT_FILTER_BACKENDS is DjangoFilterBackend alone: `search_fields`
    # without it is silently inert.
    filter_backends = [django_filters.DjangoFilterBackend, filters.SearchFilter]
    # Found by course name or subject.
    search_fields = ["title", "description", "category"]
    filterset_fields = ["is_active", "category"]


class TrainingSessionViewSet(ArchiveMixin, AuditViewSetMixin, ModelViewSet):
    serializer_class = TrainingSessionSerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]
    # `SearchFilter` is named explicitly because the project's
    # DEFAULT_FILTER_BACKENDS is DjangoFilterBackend alone: `search_fields`
    # without it is silently inert.
    filter_backends = [django_filters.DjangoFilterBackend, filters.SearchFilter]
    # Found by the course it runs, or where.
    search_fields = ["program__title", "location"]
    filterset_fields = ["program", "status"]

    def get_queryset(self):
        # Prefetch enrollments so seats_taken / my_enrollment don't N+1.
        return TrainingSession.objects.select_related("program", "trainer__user").prefetch_related(
            "enrollments"
        )

    @action(detail=True, methods=["post"])
    def assign(self, request, **kwargs):
        """HR assigns one or more employees straight into the session."""
        if not _is_hr(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        session = self.get_object()
        employee_ids = request.data.get("employee_ids", [])
        employees = Employee.objects.filter(id__in=employee_ids)
        try:
            for employee in employees:
                services.assign_enrollment(session, employee, actor=request.user)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        session = self.get_queryset().get(pk=session.pk)
        return Response(TrainingSessionSerializer(session, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="issue-certificates")
    def issue_certificates(self, request, **kwargs):
        """HR certifies the selected participants (completing them if
        needed), emails each, and marks the session completed."""
        if not _is_hr(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        session = self.get_object()
        enrollment_ids = request.data.get("enrollment_ids", [])
        issued = services.issue_session_certificates(session, enrollment_ids, actor=request.user)
        session = self.get_queryset().get(pk=session.pk)
        return Response(
            {
                "issued_count": len(issued),
                "session": TrainingSessionSerializer(session, context={"request": request}).data,
            }
        )


class EnrollmentViewSet(
    XlsxExportMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, GenericViewSet
):
    """Employees can create a *request* for themselves and cancel their own.
    HR sees everything and drives approve/decline/complete."""

    serializer_class = EnrollmentSerializer
    permission_classes = [IsAuthenticated]
    # `SearchFilter` is named explicitly because the project's
    # DEFAULT_FILTER_BACKENDS is DjangoFilterBackend alone: `search_fields`
    # without it is silently inert.
    filter_backends = [django_filters.DjangoFilterBackend, filters.SearchFilter]
    # Found by who is enrolled, or on what.
    search_fields = ["session__program__title", "employee__user__first_name", "employee__user__last_name", "employee__employee_code"]
    filterset_fields = ["session", "status", "employee"]

    export_filename = "training-enrollments.xlsx"
    export_title = "Training"
    export_headers = ["Employee", "Program", "Session", "Status", "Score"]
    export_highlight_header = "Status"
    export_validations = {"Status": ["Requested", "Enrolled", "Completed", "No show", "Cancelled", "Declined"]}

    def get_export_rows(self, queryset):
        return [
            [
                e.employee.user.get_full_name() or e.employee.user.get_username(),
                e.session.program.title,
                e.session.start_datetime.strftime("%Y-%m-%d %H:%M"),
                e.get_status_display(),
                e.score if e.score is not None else "",
            ]
            for e in queryset
        ]

    def get_queryset(self):
        qs = Enrollment.objects.select_related(
            "session__program", "employee__user"
        ).order_by("-created_at")
        if _is_hr(self.request.user):
            return qs
        # Employees only ever see their own enrollments.
        employee = getattr(self.request.user, "employee", None)
        return qs.filter(employee=employee) if employee else qs.none()

    def create(self, request, *args, **kwargs):
        """Employee self-request for a seat."""
        employee = getattr(request.user, "employee", None)
        if employee is None:
            return Response(
                {"detail": "Your account has no employee profile to enroll."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            session = TrainingSession.objects.get(pk=request.data.get("session"))
        except TrainingSession.DoesNotExist:
            return Response({"detail": "Session not found."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            enrollment = services.request_enrollment(session, employee, actor=request.user)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            EnrollmentSerializer(enrollment).data, status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=["post"])
    def approve(self, request, **kwargs):
        if not _is_hr(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        enrollment = self.get_object()
        try:
            services.approve_request(enrollment, actor=request.user)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(EnrollmentSerializer(self.get_object()).data)

    @action(detail=True, methods=["post"])
    def decline(self, request, **kwargs):
        if not _is_hr(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        services.decline_request(self.get_object(), actor=request.user)
        return Response(EnrollmentSerializer(self.get_object()).data)

    @action(detail=True, methods=["post"])
    def complete(self, request, **kwargs):
        if not _is_hr(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        serializer = CompleteEnrollmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        services.complete_enrollment(
            self.get_object(),
            status=data["status"],
            score=data.get("score"),
            feedback=data.get("feedback", ""),
            actor=request.user,
        )
        return Response(EnrollmentSerializer(self.get_object()).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, **kwargs):
        enrollment = self.get_object()
        is_owner = enrollment.employee.user_id == request.user.id
        if not (is_owner or _is_hr(request.user)):
            return Response(status=status.HTTP_403_FORBIDDEN)
        try:
            services.cancel_enrollment(enrollment, actor=request.user)
        except ValueError as exc:
            # A refusal the user can act on ("revoke the certificate first"),
            # not a server fault — 400 with the reason, so the UI can show it.
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(EnrollmentSerializer(self.get_object()).data)

    @action(detail=True, methods=["post"], url_path="issue-certificate")
    def issue_certificate(self, request, **kwargs):
        """HR issues a certificate for a single participant (completing
        them if needed). Emails the participant — see services."""
        if not _is_hr(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        enrollment = self.get_object()
        try:
            services.issue_certificate(enrollment, actor=request.user)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(EnrollmentSerializer(self.get_object()).data)

    @action(detail=True, methods=["get"])
    def certificate(self, request, **kwargs):
        """Download the participant's completion-certificate PDF. Visible
        to the participant themselves or HR."""
        enrollment = self.get_object()
        is_owner = enrollment.employee.user_id == request.user.id
        if not (is_owner or _is_hr(request.user)):
            return Response(status=status.HTTP_403_FORBIDDEN)
        document = latest_document_for(enrollment, kind=Document.Kind.CERTIFICATE)
        if document is None:
            raise Http404("No certificate has been generated for this enrollment yet.")
        return FileResponse(document.file.open("rb"), as_attachment=True, filename=document.original_filename)
