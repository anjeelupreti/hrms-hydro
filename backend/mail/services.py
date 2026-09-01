"""IMAP sync + SMTP send for the company company mailbox.

Sync pulls the latest INBOX messages into EmailMessage rows (the
sync-to-DB model chosen for Phase 11c); send goes through Django's mail
layer, which resolves to organization.CompanyAwareEmailBackend and the
company's own SMTP account. Both read credentials from the per-company
organization.CompanyEmailSettings singleton.
"""

import email
import imaplib
from email.header import decode_header, make_header
from email.utils import parseaddr, parsedate_to_datetime

from django.core.files.base import ContentFile
from django.core.mail import EmailMultiAlternatives
from django.utils import timezone

from mail.models import EmailAttachment, EmailMessage
from organization.models import CompanyEmailSettings

SYNC_LIMIT = 50  # newest N messages per sync — bounds fetch time


def _decode(value):
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def _decode_payload(part):
    payload = part.get_payload(decode=True)
    if payload is None:
        return ""
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except LookupError:
        return payload.decode("utf-8", errors="replace")


def _extract_bodies(msg):
    text, html = "", ""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_maintype() == "multipart":
                continue
            disposition = str(part.get("Content-Disposition") or "")
            if "attachment" in disposition:
                continue
            ctype = part.get_content_type()
            if ctype == "text/plain" and not text:
                text = _decode_payload(part)
            elif ctype == "text/html" and not html:
                html = _decode_payload(part)
    elif msg.get_content_type() == "text/html":
        html = _decode_payload(msg)
    else:
        text = _decode_payload(msg)
    return text, html


def _parse_date(raw):
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    if dt is not None and timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _connect(settings_obj):
    cls = imaplib.IMAP4_SSL if settings_obj.imap_use_ssl else imaplib.IMAP4
    conn = cls(settings_obj.imap_host, settings_obj.imap_port)
    conn.login(settings_obj.username, settings_obj.get_password())
    return conn


def test_imap_connection(host, port, username, password, use_ssl=True):
    """Opens + logs in + logs out. Raises on failure (caller converts to a
    400). Mirrors organization's SMTP test-before-save flow."""
    cls = imaplib.IMAP4_SSL if use_ssl else imaplib.IMAP4
    conn = cls(host, port)
    try:
        conn.login(username, password)
    finally:
        try:
            conn.logout()
        except Exception:
            pass


def sync_inbox(settings_obj=None, limit=SYNC_LIMIT):
    """Fetch the newest `limit` INBOX messages into the DB, skipping UIDs we
    already have. Returns the number of new messages imported. Safe to call
    repeatedly (idempotent via the unique folder+uid constraint)."""
    settings_obj = settings_obj or CompanyEmailSettings.get_solo()
    if not settings_obj.imap_host or not settings_obj.username:
        return 0

    conn = _connect(settings_obj)
    new_count = 0
    try:
        conn.select("INBOX")
        typ, data = conn.uid("search", None, "ALL")
        if typ != "OK" or not data or not data[0]:
            return 0
        uids = data[0].split()[-limit:]

        existing = set(
            EmailMessage.objects.filter(folder=EmailMessage.Folder.INBOX).values_list("uid", flat=True)
        )
        for uid_bytes in uids:
            uid = uid_bytes.decode()
            if uid in existing:
                continue
            typ, fetched = conn.uid("fetch", uid, "(RFC822 FLAGS)")
            if typ != "OK" or not fetched or not isinstance(fetched[0], tuple):
                continue
            raw = fetched[0][1]
            flags = imaplib.ParseFlags(fetched[0][0])
            msg = email.message_from_bytes(raw)
            _store_message(msg, uid=uid, seen=b"\\Seen" in flags)
            new_count += 1
    finally:
        try:
            conn.logout()
        except Exception:
            pass
    return new_count


def _store_message(msg, uid, seen):
    from_name, from_email = parseaddr(msg.get("From", ""))
    text, html = _extract_bodies(msg)

    record = EmailMessage.objects.create(
        folder=EmailMessage.Folder.INBOX,
        uid=uid,
        message_id=(msg.get("Message-ID") or "")[:998],
        from_email=from_email[:254],
        from_name=_decode(from_name)[:255],
        to=_decode(msg.get("To", "")),
        cc=_decode(msg.get("Cc", "")),
        subject=_decode(msg.get("Subject", ""))[:998],
        body_text=text,
        body_html=html,
        date=_parse_date(msg.get("Date")),
        is_read=seen,
    )

    has_attachment = False
    for part in msg.walk():
        filename = part.get_filename()
        if not filename:
            continue
        payload = part.get_payload(decode=True)
        if payload is None:
            continue
        EmailAttachment.objects.create(
            message=record,
            filename=_decode(filename)[:255],
            content_type=part.get_content_type(),
            file=ContentFile(payload, name=_decode(filename)),
        )
        has_attachment = True

    if has_attachment:
        record.has_attachments = True
        record.save(update_fields=["has_attachments"])
    return record


def send_email(to, subject, body, cc=None):
    """Send through the company SMTP backend and record a local SENT copy.
    from_email is left to CompanyAwareEmailBackend (it overrides it to the
    company's configured From address)."""
    settings_obj = CompanyEmailSettings.get_solo()
    message = EmailMultiAlternatives(
        subject=subject,
        body=body,
        to=[addr.strip() for addr in to.split(",") if addr.strip()],
        cc=[addr.strip() for addr in (cc or "").split(",") if addr.strip()] or None,
    )
    message.send(fail_silently=False)

    return EmailMessage.objects.create(
        folder=EmailMessage.Folder.SENT,
        from_email=settings_obj.from_email or "",
        to=to,
        cc=cc or "",
        subject=subject,
        body_text=body,
        date=timezone.now(),
        is_read=True,
        is_outgoing=True,
    )
