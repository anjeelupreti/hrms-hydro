import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives, send_mail
from django.template.loader import render_to_string
from django.utils import timezone

logger = logging.getLogger(__name__)

BRAND_NAME = "HRMS"


def safe_send_mail(subject, message, recipient_list, from_email=None):
    """send_mail that never raises — a bounce/rejection (unroutable
    domain, provider throttling, ...) must not break whatever business
    action triggered the email (password reset, employee onboarding,
    leave approval, ...). Logs and moves on instead."""
    try:
        send_mail(
            subject=subject,
            message=message,
            from_email=from_email or settings.DEFAULT_FROM_EMAIL,
            recipient_list=recipient_list,
        )
        return True
    except Exception:
        logger.warning("Email send failed: subject=%r to=%r", subject, recipient_list, exc_info=True)
        return False


def _plain_text_version(*, heading, greeting, intro, paragraphs, facts, cta_label, cta_url, outro):
    """A readable text/plain fallback built from the same pieces as the
    HTML template — every email is multipart so text-only clients (and
    spam filters that penalise HTML-only mail) get a clean version."""
    lines = []
    if heading:
        lines += [heading, ""]
    if greeting:
        lines += [greeting, ""]
    if intro:
        lines += [intro, ""]
    for para in paragraphs or []:
        lines += [para, ""]
    for fact in facts or []:
        lines.append(f"{fact['label']}: {fact['value']}")
    if facts:
        lines.append("")
    if cta_label and cta_url:
        lines += [f"{cta_label}: {cta_url}", ""]
    if outro:
        lines += [outro, ""]
    lines += ["—", f"This is an automated message from {BRAND_NAME}."]
    return "\n".join(lines).strip() + "\n"


def send_templated_mail(
    subject,
    recipient_list,
    *,
    heading=None,
    greeting=None,
    intro=None,
    paragraphs=None,
    facts=None,
    cta_label=None,
    cta_url=None,
    outro=None,
    from_email=None,
    attachments=None,
):
    """Sends a branded, responsive HTML email (with a plain-text
    alternative) using core/templates/emails/base_email.html. Never
    raises — same fail-soft contract as safe_send_mail.

    `facts` is a list of {"label", "value"} dicts rendered as a styled
    key/value box (e.g. credentials on onboarding). `cta_label`/`cta_url`
    render a call-to-action button. `attachments` is a list of
    (filename, content_bytes, mimetype) tuples (e.g. a certificate PDF)."""
    context = {
        "brand_name": BRAND_NAME,
        "subject": subject,
        "heading": heading or subject,
        "greeting": greeting,
        "intro": intro,
        "paragraphs": paragraphs or [],
        "facts": facts or [],
        "cta_label": cta_label,
        "cta_url": cta_url,
        "outro": outro,
        "year": timezone.now().year,
    }
    try:
        html_body = render_to_string("emails/base_email.html", context)
        text_body = _plain_text_version(
            heading=heading or subject,
            greeting=greeting,
            intro=intro,
            paragraphs=paragraphs,
            facts=facts,
            cta_label=cta_label,
            cta_url=cta_url,
            outro=outro,
        )
        message = EmailMultiAlternatives(
            subject=subject,
            body=text_body,
            from_email=from_email or settings.DEFAULT_FROM_EMAIL,
            to=recipient_list,
        )
        message.attach_alternative(html_body, "text/html")
        for filename, content, mimetype in attachments or []:
            message.attach(filename, content, mimetype)
        message.send()
        return True
    except Exception:
        logger.warning("Templated email send failed: subject=%r to=%r", subject, recipient_list, exc_info=True)
        return False
