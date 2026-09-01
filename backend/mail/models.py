from django.db import models


def attachment_upload_path(instance, filename):
    # Company-schema-namespaced, same reasoning as documents.document_upload_path
    # and organization.company_logo_upload_path — all companies share one local
    # disk for now.
    return f"mail/attachments/{instance.message_id}/{filename}"


class EmailMessage(models.Model):
    """A message synced from the company mailbox over IMAP (folder=INBOX),
    or a copy of one we sent (folder=SENT, is_outgoing=True).

    Not an AuditModel: inbound mail has no `created_by` (it's synced, not
    authored here), and `synced_at`/`sent_at` semantics don't map onto
    created/updated. `uid` is the IMAP UID, unique within a folder — the
    dedup key so re-syncing never double-imports. Message content lives in
    the company DB (the sync-to-DB model chosen for Phase 11c); acceptable
    for the shared-disk stage, revisit alongside S3 (see docs/development-plan.md).
    """

    class Folder(models.TextChoices):
        INBOX = "inbox", "Inbox"
        SENT = "sent", "Sent"

    folder = models.CharField(max_length=10, choices=Folder.choices, default=Folder.INBOX)
    uid = models.CharField(max_length=255, blank=True)  # IMAP UID (blank for locally-recorded SENT)
    message_id = models.CharField(max_length=998, blank=True)  # RFC 5322 Message-ID header

    from_email = models.EmailField(blank=True)
    from_name = models.CharField(max_length=255, blank=True)
    to = models.TextField(blank=True)  # raw To header (comma-separated)
    cc = models.TextField(blank=True)
    subject = models.CharField(max_length=998, blank=True)

    body_text = models.TextField(blank=True)
    body_html = models.TextField(blank=True)

    date = models.DateTimeField(null=True, blank=True)  # email Date header
    is_read = models.BooleanField(default=False)
    is_outgoing = models.BooleanField(default=False)
    has_attachments = models.BooleanField(default=False)

    synced_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date"]
        indexes = [models.Index(fields=["folder", "-date"])]
        constraints = [
            # UID is unique per folder — the IMAP dedup key. SENT rows have a
            # blank uid, so this only meaningfully constrains synced INBOX rows.
            models.UniqueConstraint(
                fields=["folder", "uid"],
                condition=~models.Q(uid=""),
                name="unique_folder_uid",
            )
        ]

    def __str__(self):
        return f"[{self.folder}] {self.subject or '(no subject)'}"


class EmailAttachment(models.Model):
    message = models.ForeignKey(EmailMessage, on_delete=models.CASCADE, related_name="attachments")
    filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=255, blank=True)
    file = models.FileField(upload_to=attachment_upload_path)

    def __str__(self):
        return self.filename
