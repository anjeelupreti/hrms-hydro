from django.db import models

from core.models import AuditModel


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


# ── The correspondence register ──────────────────────────────────────────
#
# **Deliberately not `EmailMessage`.** That is a *mailbox* — rows synced from
# IMAP, keyed by IMAP UID, with `to` and `cc` as raw headers. A register is a
# different object: it has a reference number the office assigns, a subject
# somebody chose, a company it belongs to, people to notify internally, and it
# exists whether or not an email was ever sent — a letter that arrived by post
# has no Message-ID at all.
#
# Conflating them would mean every register query filtering out synced mail and
# every sync taking care not to clobber a register row. They stay separate, and
# an outgoing letter records that it sent something.


def letter_attachment_path(instance, filename):
    kind = "outgoing" if instance.outgoing_id else "incoming"
    row = instance.outgoing_id or instance.incoming_id
    return f"correspondence/{kind}/{row}/{filename}"


class OutgoingLetter(AuditModel):
    """A letter this office sent, and the act of sending it.

    **The register entry is the durable thing; the email is an attempt.**
    `send_templated_mail` is fail-soft and never raises, so a naive
    implementation would save the letter, fail to reach the mail server, and
    report success. The row is written first, the send is tried second, and
    `status` records what actually happened — with `error` saying why, and a
    resend available. A registry that quietly loses letters is worse than a
    paper one.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENT = "sent", "Sent"
        #: Written to the register, but the mail server would not take it.
        FAILED = "failed", "Not delivered"
        #: Recorded for the register only — hand-delivered, or posted.
        NOT_EMAILED = "not_emailed", "Recorded, not emailed"

    #: **Typed, not generated.** The office keeps its own numbering convention
    #: and a register that imposed one would be a register nobody's filing
    #: cabinet agrees with. Unique per company, and the API suggests the next
    #: number without insisting on it.
    ref = models.CharField(max_length=60)
    company = models.ForeignKey(
        "companies.Company", null=True, blank=True,
        on_delete=models.PROTECT, related_name="outgoing_letters",
    )
    letter_date = models.DateField()
    subject = models.CharField(max_length=300)
    body = models.TextField(blank=True)

    #: Where it went. Stored as rows rather than a comma-separated header,
    #: because "who did we write to about this" is a question the register is
    #: asked and a text field cannot answer.
    recipients = models.JSONField(default=list, blank=True)
    cc = models.JSONField(default=list, blank=True)

    #: Which office, in words. An email address is not the recipient — "the
    #: District Administration Office, Rasuwa" is, and that is what somebody
    #: searches the register for.
    addressed_to = models.CharField(max_length=300, blank=True)

    status = models.CharField(max_length=14, choices=Status.choices, default=Status.DRAFT)
    sent_at = models.DateTimeField(null=True, blank=True)
    #: Why the mail server refused it. Shown beside the resend button, because
    #: "it failed" without a reason is not something anybody can act on.
    error = models.TextField(blank=True)

    class Meta:
        ordering = ["-letter_date", "-pk"]
        constraints = [
            models.UniqueConstraint(
                fields=["company", "ref"], name="one_outgoing_ref_per_company"
            )
        ]

    def __str__(self):
        return f"{self.ref} — {self.subject}"


class IncomingLetter(AuditModel):
    """A letter that arrived, recorded by hand.

    **Nothing is synced here on purpose.** Letters arrive by post, by hand, and
    into half a dozen personal mailboxes; a register that only captured what
    reached one monitored inbox would be a register with holes in it and no way
    to tell. Somebody enters it, which is what the paper register already
    required — the gain is that it is then searchable and can notify the people
    who need to see it.
    """

    class Via(models.TextChoices):
        POST = "post", "By post"
        EMAIL = "email", "By email"
        HAND = "hand", "By hand"
        OTHER = "other", "Other"

    ref = models.CharField(max_length=60)
    company = models.ForeignKey(
        "companies.Company", null=True, blank=True,
        on_delete=models.PROTECT, related_name="incoming_letters",
    )
    #: The date on the letter, which is not the date it arrived — a letter
    #: dated the 3rd that reached the office on the 11th is eight days of
    #: someone else's delay, and a register that recorded one number could not
    #: show that.
    letter_date = models.DateField(null=True, blank=True)
    received_on = models.DateField()

    subject = models.CharField(max_length=300)
    from_office = models.CharField(max_length=300)
    from_person = models.CharField(max_length=200, blank=True)
    from_email = models.EmailField(blank=True)
    received_via = models.CharField(max_length=10, choices=Via.choices, default=Via.POST)

    #: Who inside the office needs to see it. Notified in the product and by
    #: email — the point of registering a letter is that it reaches somebody.
    notify = models.ManyToManyField(
        "employees.Employee", blank=True, related_name="incoming_letters"
    )
    note = models.TextField(blank=True)

    #: What this answers, where it answers something. Registers track the
    #: thread, and the link is cheap now and awkward to backfill later.
    in_reply_to = models.ForeignKey(
        OutgoingLetter, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="replies",
    )

    class Meta:
        ordering = ["-received_on", "-pk"]
        constraints = [
            models.UniqueConstraint(
                fields=["company", "ref"], name="one_incoming_ref_per_company"
            )
        ]

    def __str__(self):
        return f"{self.ref} — {self.subject}"


class LetterAttachment(models.Model):
    """A file on a letter, either direction.

    One table rather than two: an attachment is the same object whichever way
    the letter went, and two tables would mean two upload paths, two
    serializers and two places to fix the next thing.
    """

    outgoing = models.ForeignKey(
        OutgoingLetter, null=True, blank=True,
        on_delete=models.CASCADE, related_name="attachments",
    )
    incoming = models.ForeignKey(
        IncomingLetter, null=True, blank=True,
        on_delete=models.CASCADE, related_name="attachments",
    )
    file = models.FileField(upload_to=letter_attachment_path)
    caption = models.CharField(max_length=200, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["pk"]
        constraints = [
            # One side or the other, never both and never neither — an
            # attachment belonging to nothing is a file nobody can reach.
            models.CheckConstraint(
                condition=(
                    models.Q(outgoing__isnull=False, incoming__isnull=True)
                    | models.Q(outgoing__isnull=True, incoming__isnull=False)
                ),
                name="attachment_belongs_to_one_letter",
            )
        ]

    def __str__(self):
        return self.file.name
