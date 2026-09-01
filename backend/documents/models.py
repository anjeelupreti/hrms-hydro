from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

from core.models import AuditModel


def document_upload_path(instance, filename):
    # Company schema is part of the path — all companies currently share one
    # local disk (MEDIA_ROOT), so this is the only thing preventing one
    # company's uploads from colliding with (or being enumerable alongside)
    # another's. Keep this even after moving to S3-compatible storage.
    return f"documents/{instance.content_type.model}/{instance.object_id}/{filename}"


class Document(AuditModel):
    """Generic file store: any company-scoped model can own documents via
    the ContentType framework, instead of every app growing its own
    FileField + storage-path logic. Payslip PDFs are the first consumer;
    employee contracts/uploads (Phase 14) will reuse this unchanged."""

    class Kind(models.TextChoices):
        PAYSLIP = "payslip", "Payslip"
        CERTIFICATE = "certificate", "Certificate"
        #: The letter a candidate is sent, stored against the offer.
        #:
        #: Its own kind rather than `GENERIC` because it is the only document
        #: here addressed to somebody who is **not yet an employee**, and that
        #: matters when a workspace clears out old files: an offer letter for a
        #: candidate who declined is still the record of what was offered, and
        #: deleting it as "generic clutter" loses the one artefact a dispute
        #: turns on.
        OFFER_LETTER = "offer_letter", "Offer letter"
        #: A file somebody attached to a task — a spec, a screenshot of the bug,
        #: the signed-off design. Named rather than filed under `GENERIC` so a
        #: company clearing out old uploads can tell project working files from
        #: whatever else happens to be generic.
        ATTACHMENT = "attachment", "Attachment"
        GENERIC = "generic", "Generic"

    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.GENERIC)
    file = models.FileField(upload_to=document_upload_path)
    original_filename = models.CharField(max_length=255, blank=True)
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveBigIntegerField()
    content_object = GenericForeignKey("content_type", "object_id")

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["content_type", "object_id"])]

    def __str__(self):
        return self.original_filename or self.file.name


def repository_upload_path(instance, filename):
    scope = "company" if instance.visibility == RepositoryDocument.Visibility.COMPANY else f"employee/{instance.employee_id}"
    return f"repository/{scope}/{filename}"


class RepositoryDocument(AuditModel):
    """A standalone document in the company repository — a policy/contract/
    form everyone can read, or a personal document tied to one employee.
    Distinct from `Document` (which is generic-linked to another record
    like a payslip); this one stands on its own."""

    class Category(models.TextChoices):
        POLICY = "policy", "Policy"
        CONTRACT = "contract", "Contract"
        FORM = "form", "Form"
        HANDBOOK = "handbook", "Handbook"
        PERSONAL = "personal", "Personal"
        OTHER = "other", "Other"

    class Visibility(models.TextChoices):
        """Who may read this document.

        The employee chooses this for their own documents — the whole point of
        the setting. `PERSONAL` is retained as the historical default and now
        means the same as `HR_ONLY`, so existing rows keep their exact
        behaviour rather than being widened or narrowed by a migration.
        """

        PRIVATE = "private", "Only me"
        PERSONAL = "personal", "Me and HR"        # legacy value, == HR_ONLY
        HR_ONLY = "hr_only", "Me and HR"
        MANAGER = "manager", "Me, HR and my manager"
        COMPANY = "company", "Everyone in the company"

    title = models.CharField(max_length=200)
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.OTHER)
    visibility = models.CharField(max_length=20, choices=Visibility.choices, default=Visibility.COMPANY)
    # Set only for personal-visibility documents: whose document it is.
    employee = models.ForeignKey(
        "employees.Employee", null=True, blank=True, on_delete=models.CASCADE, related_name="documents"
    )
    description = models.TextField(blank=True)
    file = models.FileField(upload_to=repository_upload_path)
    original_filename = models.CharField(max_length=255, blank=True)

    # HR access to this document is not the employee's to revoke.
    #
    # **The honest limit on employee-controlled visibility.** A citizenship
    # scan, a PAN certificate or a bank letter is what statutory filing and
    # paying somebody actually require. If `PRIVATE` hid those from HR, either
    # payroll breaks or the setting is a lie — and a privacy control that
    # silently does not apply is worse than not offering one.
    #
    # So the employee still chooses who *else* sees it, HR retains access to
    # statutory documents, and **every HR read is logged** (`DocumentAccessLog`)
    # so the employee can see who looked and when. Visible access is the
    # honest trade for access that cannot be withdrawn.
    is_statutory = models.BooleanField(
        default=False,
        help_text="Required for compliance or payroll — HR can always read it, and every read is logged.",
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title

    def readable_by(self, user):
        """Whether `user` may read this document.

        One method, used by the queryset filter *and* the download view, so the
        list and the file can never disagree — a document hidden from a list
        but downloadable by URL is not hidden.
        """
        # Imported here rather than at module scope: `accounts.policy` reaches
        # the user model, and documents is imported early enough that a
        # top-level import would be circular.
        from accounts.policy import Perm, can

        if user.is_superuser:
            return True

        is_hr = can(user, Perm.PEOPLE_MANAGE)
        employee = getattr(user, "employee", None)

        # Company-wide documents (policies, handbooks) are readable by all.
        if self.visibility == self.Visibility.COMPANY and self.employee_id is None:
            return True

        # A document with no owner and personal visibility is an HR artefact.
        if self.employee_id is None:
            return is_hr

        if employee is not None and employee.pk == self.employee_id:
            return True  # your own document, always

        if is_hr:
            # HR sees statutory documents regardless of the employee's choice,
            # and anything the employee has shared at HR level or wider.
            return self.is_statutory or self.visibility != self.Visibility.PRIVATE

        if self.visibility == self.Visibility.MANAGER and employee is not None:
            owner = type(employee).objects.filter(pk=self.employee_id).first()
            return owner is not None and owner.manager_id == employee.pk

        return self.visibility == self.Visibility.COMPANY


class DocumentAccessLog(models.Model):
    """Who read somebody else's document, and when.

    Exists because HR's access to statutory documents cannot be revoked by the
    employee (see `RepositoryDocument.is_statutory`). Access that cannot be
    withdrawn should at least be *visible* to the person it concerns, so this is
    surfaced to the employee rather than kept as an admin-only audit trail.

    Append-only, and deliberately not an `AuditModel`: the log records reads, so
    giving it an `updated_by` would imply a log entry can be edited.
    """

    document = models.ForeignKey(
        RepositoryDocument, on_delete=models.CASCADE, related_name="access_log"
    )
    accessed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    accessed_at = models.DateTimeField(auto_now_add=True)
    # Recorded per read rather than derived later: the reason someone was
    # allowed in is part of the record, and the rule may change afterwards.
    reason = models.CharField(
        max_length=50,
        blank=True,
        help_text="Why access was granted, e.g. 'statutory' or 'shared'.",
    )

    class Meta:
        ordering = ["-accessed_at"]
        indexes = [models.Index(fields=["document", "-accessed_at"])]

    def __str__(self):
        return f"{self.document_id} read by {self.accessed_by_id} at {self.accessed_at}"


class SignatureRequest(AuditModel):
    """A request to have one or more people e-sign a repository document
    (a contract, policy acknowledgement, form…). `created_by` (AuditModel)
    is the requester. Completes once every signer has signed."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    document = models.ForeignKey(
        RepositoryDocument, on_delete=models.CASCADE, related_name="signature_requests"
    )
    message = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Signature request #{self.pk} on {self.document_id}"

    def refresh_status(self):
        """Advance to COMPLETED once no signature is still pending. A single
        decline leaves it PENDING (the requester can cancel/re-request) —
        deliberately not auto-failing the whole request on one decline."""
        sigs = list(self.signatures.all())
        if sigs and all(s.status == DocumentSignature.Status.SIGNED for s in sigs):
            from django.utils import timezone

            self.status = self.Status.COMPLETED
            self.completed_at = timezone.now()
            self.save(update_fields=["status", "completed_at"])


class DocumentSignature(AuditModel):
    """One signer's slot on a SignatureRequest. Signing is "adopt a typed
    name" (records name + timestamp + IP for the audit trail) — a
    lightweight, legally-common e-signature, not cryptographic signing."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SIGNED = "signed", "Signed"
        DECLINED = "declined", "Declined"

    request = models.ForeignKey(
        SignatureRequest, on_delete=models.CASCADE, related_name="signatures"
    )
    signer = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="signature_slots"
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    signed_name = models.CharField(max_length=200, blank=True)
    signed_at = models.DateTimeField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    decline_reason = models.CharField(max_length=255, blank=True)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["request", "signer"], name="unique_signer_per_request")
        ]

    def __str__(self):
        return f"{self.signer_id} — {self.status}"
