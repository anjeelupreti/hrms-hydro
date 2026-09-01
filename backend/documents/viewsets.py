from django.db.models import Q
from django.http import FileResponse, Http404
from django.utils import timezone
from django_filters import rest_framework as django_filters
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.mixins import (
    CreateModelMixin,
    DestroyModelMixin,
    ListModelMixin,
    RetrieveModelMixin,
)
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from accounts.policy import Perm, can
from attendance.permissions import _requesting_employee
from core.viewsets import AuditViewSetMixin
from documents.models import (
    DocumentAccessLog,
    DocumentSignature,
    RepositoryDocument,
    SignatureRequest,
)
from documents.serializers import (
    MySignatureSerializer,
    RepositoryDocumentSerializer,
    SignatureRequestSerializer,
)
from notifications.services import notify


def _client_ip(request):
    fwd = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return (fwd.split(",")[0].strip() if fwd else request.META.get("REMOTE_ADDR")) or None


def _is_hr(user):
    """Thin adapter over the one policy (accounts/policy.py).

    Kept as a local name so every call site in this file reads the same
    as it did; what it *means* is now decided in one place rather than
    re-derived here.
    """
    return can(user, Perm.PEOPLE_MANAGE)


class RepositoryDocumentViewSet(
    AuditViewSetMixin, ListModelMixin, RetrieveModelMixin, CreateModelMixin, DestroyModelMixin, GenericViewSet
):
    serializer_class = RepositoryDocumentSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [django_filters.DjangoFilterBackend]
    filterset_fields = ["category", "visibility", "employee"]

    def get_queryset(self):
        """The same rules as `RepositoryDocument.readable_by`, as a query.

        Expressed twice on purpose — once as a filter for lists and once as a
        predicate for a single object — because a document that is hidden from
        the list but still downloadable by URL is not hidden. The tests assert
        the two agree.
        """
        qs = RepositoryDocument.objects.select_related("employee__user", "created_by")
        user = self.request.user
        if user.is_superuser:
            return qs

        employee = _requesting_employee(user)

        # Company-wide documents with no owner: policies, handbooks, forms.
        cond = Q(visibility=RepositoryDocument.Visibility.COMPANY, employee__isnull=True)

        if employee is not None:
            cond |= Q(employee=employee)  # your own, whatever you set it to
            # A manager sees a direct report's document only when that report
            # chose to share it up the line.
            cond |= Q(
                visibility=RepositoryDocument.Visibility.MANAGER,
                employee__manager=employee,
            )

        if _is_hr(user):
            # HR sees unowned documents, anything statutory, and anything the
            # employee has shared at HR level or wider — but **not** a personal
            # document the employee marked private, unless it is statutory.
            # That exception is the entire point of `is_statutory`.
            cond |= Q(employee__isnull=True)
            cond |= Q(is_statutory=True)
            cond |= ~Q(visibility=RepositoryDocument.Visibility.PRIVATE)
        else:
            cond |= Q(visibility=RepositoryDocument.Visibility.COMPANY)

        return qs.filter(cond).distinct()

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        visibility = serializer.validated_data.get("visibility", RepositoryDocument.Visibility.COMPANY)
        employee = serializer.validated_data.get("employee")

        if not _is_hr(request.user):
            # Non-HR may only upload for themselves — but may choose any
            # visibility *except* company-wide. Publishing to the whole company
            # is a broadcast, not a personal filing decision, and the previous
            # rule was narrower than that: it pinned employees to PERSONAL, so
            # an employee could not mark their own document private.
            own = _requesting_employee(request.user)
            if own is None or employee != own:
                return Response(
                    {"detail": "You can only upload personal documents for yourself."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            if visibility == RepositoryDocument.Visibility.COMPANY:
                return Response(
                    {"detail": "Only HR can publish a document company-wide."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            # Employees cannot mark their own upload statutory: that flag is
            # what makes HR access non-revocable, so it is not self-assignable
            # in either direction.
            serializer.validated_data["is_statutory"] = False

        uploaded = request.data.get("file")
        instance = serializer.save(
            created_by=request.user,
            updated_by=request.user,
            original_filename=getattr(uploaded, "name", ""),
        )
        return Response(self.get_serializer(instance).data, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        own = _requesting_employee(request.user)
        is_owner = instance.employee is not None and own is not None and instance.employee_id == own.id
        if not (_is_hr(request.user) or is_owner):
            return Response(status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["get"])
    def download(self, request, *args, **kwargs):
        document = self.get_object()  # get_queryset enforces visibility
        if not document.file:
            raise Http404("File missing.")

        # Log reads of somebody *else's* personal document. Not your own —
        # a log full of "you opened your own payslip" buries the entry that
        # matters, which is somebody else opening it.
        own = _requesting_employee(request.user)
        is_owner = own is not None and document.employee_id == own.pk
        if document.employee_id is not None and not is_owner:
            DocumentAccessLog.objects.create(
                document=document,
                accessed_by=request.user,
                reason="statutory" if document.is_statutory else "shared",
            )

        return FileResponse(
            document.file.open("rb"),
            as_attachment=True,
            filename=document.original_filename or document.file.name.split("/")[-1],
        )

    @action(detail=True, methods=["post"], url_path="set-visibility")
    def set_visibility(self, request, *args, **kwargs):
        """Change who can see a personal document.

        The employee's own control, which is why it is a dedicated action
        rather than a PATCH: this viewset has no update mixin, and adding one
        would expose every other field for editing alongside it.
        """
        document = self.get_object()
        own = _requesting_employee(request.user)
        is_owner = own is not None and document.employee_id == own.pk

        if not (is_owner or _is_hr(request.user) or request.user.is_superuser):
            return Response(status=status.HTTP_403_FORBIDDEN)

        visibility = request.data.get("visibility")
        valid = {choice for choice, _ in RepositoryDocument.Visibility.choices}
        if visibility not in valid:
            return Response(
                {"detail": f"Visibility must be one of: {', '.join(sorted(valid))}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if visibility == RepositoryDocument.Visibility.COMPANY and not _is_hr(request.user):
            return Response(
                {"detail": "Only HR can publish a document company-wide."},
                status=status.HTTP_403_FORBIDDEN,
            )

        document.visibility = visibility
        document.updated_by = request.user
        document.save(update_fields=["visibility", "updated_by", "updated_at"])
        return Response(self.get_serializer(document).data)

    @action(detail=True, methods=["get"], url_path="access-log")
    def access_log(self, request, *args, **kwargs):
        """Who has read this document.

        Surfaced to the **owner**, not only to HR. HR's access to a statutory
        document cannot be revoked by the employee, so the least this owes them
        is knowing it happened — access that cannot be withdrawn should at
        minimum be visible to the person it concerns.
        """
        document = self.get_object()
        own = _requesting_employee(request.user)
        is_owner = own is not None and document.employee_id == own.pk
        if not (is_owner or _is_hr(request.user) or request.user.is_superuser):
            return Response(status=status.HTTP_403_FORBIDDEN)

        rows = document.access_log.select_related("accessed_by")[:200]
        return Response([
            {
                "accessed_by": (
                    row.accessed_by.get_full_name() or row.accessed_by.get_username()
                ) if row.accessed_by else "(deleted user)",
                "accessed_at": row.accessed_at,
                "reason": row.reason,
            }
            for row in rows
        ])

    @action(detail=True, methods=["post"], url_path="request-signatures")
    def request_signatures(self, request, *args, **kwargs):
        """HR or the document's owner asks one or more employees to e-sign it."""
        document = self.get_object()
        own = _requesting_employee(request.user)
        is_owner = document.employee_id and own is not None and document.employee_id == own.id
        if not (_is_hr(request.user) or is_owner):
            return Response({"detail": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)

        signer_ids = request.data.get("signer_ids") or []
        message = (request.data.get("message") or "").strip()
        from employees.models import Employee

        employees = list(Employee.objects.filter(id__in=signer_ids).select_related("user"))
        if not employees:
            return Response({"detail": "Select at least one signer."}, status=status.HTTP_400_BAD_REQUEST)

        sr = SignatureRequest.objects.create(
            document=document, message=message, created_by=request.user, updated_by=request.user
        )
        for i, emp in enumerate(employees):
            DocumentSignature.objects.create(
                request=sr, signer=emp, order=i, created_by=request.user, updated_by=request.user
            )
            if emp.user_id:
                notify(
                    emp.user,
                    "document_signature_requested",
                    f"You've been asked to sign “{document.title}”.",
                    email_subject="Signature requested",
                )
        return Response(SignatureRequestSerializer(sr).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def signatures(self, request, *args, **kwargs):
        """Audit trail: every signature request + signer status for a document."""
        document = self.get_object()
        qs = document.signature_requests.prefetch_related("signatures__signer__user").select_related("created_by")
        return Response(SignatureRequestSerializer(qs, many=True).data)


class DocumentSignatureViewSet(AuditViewSetMixin, ListModelMixin, RetrieveModelMixin, GenericViewSet):
    """A signer's own e-signature queue: list, then sign or decline. Scoped
    to the requesting employee, so you can only act on your own slots."""

    serializer_class = MySignatureSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        employee = _requesting_employee(self.request.user)
        if employee is None:
            return DocumentSignature.objects.none()
        return DocumentSignature.objects.filter(signer=employee).select_related(
            "request__document", "request__created_by"
        )

    @action(detail=True, methods=["post"])
    def sign(self, request, *args, **kwargs):
        sig = self.get_object()
        if sig.status != DocumentSignature.Status.PENDING:
            return Response({"detail": "This has already been actioned."}, status=status.HTTP_400_BAD_REQUEST)
        signed_name = (request.data.get("signed_name") or "").strip()
        if not signed_name:
            return Response({"detail": "Type your name to adopt your signature."}, status=status.HTTP_400_BAD_REQUEST)
        sig.status = DocumentSignature.Status.SIGNED
        sig.signed_name = signed_name
        sig.signed_at = timezone.now()
        sig.ip_address = _client_ip(request)
        sig.save(update_fields=["status", "signed_name", "signed_at", "ip_address"])
        sig.request.refresh_status()
        if sig.request.status == SignatureRequest.Status.COMPLETED and sig.request.created_by_id:
            notify(
                sig.request.created_by,
                "document_signed",
                f"All signatures collected on “{sig.request.document.title}”.",
                email_subject="Document fully signed",
            )
        return Response(MySignatureSerializer(sig).data)

    @action(detail=True, methods=["post"])
    def decline(self, request, *args, **kwargs):
        sig = self.get_object()
        if sig.status != DocumentSignature.Status.PENDING:
            return Response({"detail": "This has already been actioned."}, status=status.HTTP_400_BAD_REQUEST)
        sig.status = DocumentSignature.Status.DECLINED
        sig.decline_reason = (request.data.get("reason") or "").strip()
        sig.save(update_fields=["status", "decline_reason"])
        if sig.request.created_by_id:
            notify(
                sig.request.created_by,
                "document_signature_declined",
                f"A signer declined “{sig.request.document.title}”.",
                email_subject="Signature declined",
            )
        return Response(MySignatureSerializer(sig).data)
