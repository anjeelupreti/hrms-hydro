
from django.template.loader import render_to_string

from documents.models import Document
from documents.services import save_generated_document
from payroll.periods import period_window


def generate_payslip_pdf(payslip, actor=None):
    """Renders and stores the branded, itemized payslip PDF. Called from
    the per-employee Celery task after compute_payslip() — never inline
    during the HTTP request, since WeasyPrint rendering is too slow to do
    synchronously for a whole payroll run.

    Import is deliberately local: WeasyPrint requires native GTK/Pango
    libraries (Cairo/Pango/GdkPixbuf) that aren't part of the Python
    package and aren't installed by default on Windows — importing it at
    module level would crash the whole Django process (API + dev server)
    on any machine missing them, even though only this one function
    needs it. See backend/payroll/README.md for the Windows install step.
    """
    from weasyprint import HTML

    from core.calendars import UnsupportedDateError, company_calendar
    from core.numbers import amount_to_words
    from organization.models import CompanyProfile

    run = payslip.payroll_run
    company = CompanyProfile.get_solo()

    # The period in the company's own calendar. Best-effort: a date outside the
    # conversion table must not stop a payslip being produced, so the Gregorian
    # period always renders and the local one is added when it can be.
    period_local = ""
    try:
        # The company's calendar, not Nepal's by assumption — a payslip
        # stamped with a fiscal year the company does not use is worse
        # than one with no local date at all.
        calendar = company_calendar()
        # The run's own window (D‑06). This built `date(run.period_year,
        # run.period_month, 1)` and converted *that* — so on a BS run it read
        # 2083-05-01 as a Gregorian date and converted it a second time,
        # printing a period some fifty-seven years out on the document the
        # employee actually keeps.
        period_start, _end, _days = period_window(run)
        local = calendar.from_gregorian(period_start)
        fiscal = calendar.fiscal_year_label(calendar.fiscal_year_of(period_start))
        period_local = f"{calendar.month_name(local.month)} {local.year} · FY {fiscal}"
    except (UnsupportedDateError, ValueError):
        period_local = ""

    html_string = render_to_string(
        "payroll/payslip.html",
        {
            "payslip": payslip,
            "employee": payslip.employee,
            "payroll_run": run,
            "company": company,
            "period_local": period_local,
            "net_pay_words": amount_to_words(payslip.net_pay),
            "earnings": payslip.line_items.filter(component_type="earning"),
            "deductions": payslip.line_items.filter(component_type="deduction"),
        },
    )
    pdf_bytes = HTML(string=html_string).write_pdf()
    filename = (
        f"payslip-{payslip.employee.employee_code}-"
        f"{payslip.payroll_run.period_calendar}-{payslip.payroll_run.period_year}-{payslip.payroll_run.period_month:02d}.pdf"
    )
    return save_generated_document(payslip, filename, pdf_bytes, kind=Document.Kind.PAYSLIP, actor=actor)
