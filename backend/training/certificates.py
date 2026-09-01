from django.template.loader import render_to_string

from documents.models import Document
from documents.services import save_generated_document


def _slug(value):
    return "".join(c if c.isalnum() else "_" for c in value).strip("_")


def generate_certificate_pdf(enrollment, actor=None):
    """Renders and stores a completion-certificate PDF for one enrollment.

    Import is deliberately local — WeasyPrint needs native GTK/Pango
    libraries that aren't installed by default (see payroll/pdf.py for the
    full rationale). Callers wrap this in try/except so a missing renderer
    never breaks the certificate-issuing workflow; the figures/record are
    already committed and the PDF can be regenerated later.
    """
    from weasyprint import HTML

    session = enrollment.session
    seconds = (session.end_datetime - session.start_datetime).total_seconds()
    duration_hours = round(seconds / 3600, 1) if seconds > 0 else 0
    employee_name = enrollment.employee.user.get_full_name() or enrollment.employee.user.get_username()

    html_string = render_to_string(
        "training/certificate.html",
        {
            "employee_name": employee_name,
            "employee_code": enrollment.employee.employee_code,
            "program": session.program,
            "session": session,
            "duration_hours": duration_hours,
            "score": enrollment.score,
            "completed_on": enrollment.completed_at or session.end_datetime,
        },
    )
    pdf_bytes = HTML(string=html_string).write_pdf()
    filename = f"certificate-{enrollment.employee.employee_code}-{_slug(session.program.title)[:32]}.pdf"
    return save_generated_document(
        enrollment, filename, pdf_bytes, kind=Document.Kind.CERTIFICATE, actor=actor
    )
