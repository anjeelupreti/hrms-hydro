"""Rendering a payment batch into the file a bank will accept.

**Layouts are data, not code.** §1.1 advantage #2 is that our rules are
configurable; the moment one Nepali bank's column order is written into a Python
function, adding the next bank is a release and supporting a bank we have never
seen is impossible. So a format is a list of column definitions, and the renderer
is one function that knows nothing about any particular bank.

The built-in formats below are **starting points, not specifications**. Every
bank publishes its own bulk-upload template and they differ in column order,
header presence and date format. A company is expected to correct these against
the template their bank actually gave them — which they can do, because it is
data.
"""

import csv
import io

#: Fields a column can draw from. Kept small and explicit rather than allowing
#: arbitrary attribute access: a format is company-editable data, and letting it
#: name any attribute would make a CSV template into a way to read the model.
FIELD_SOURCES = {
    "account_name": lambda item, batch: item.account_name,
    "account_number": lambda item, batch: item.account_number,
    "account_type": lambda item, batch: item.account_type,
    "branch": lambda item, batch: item.branch,
    "amount": lambda item, batch: f"{item.amount:.2f}",
    "amount_no_decimals": lambda item, batch: str(int(item.amount)),
    "employee_code": lambda item, batch: item.payslip.employee.employee_code,
    "bank_name": lambda item, batch: batch.bank_name,
    "narration": lambda item, batch: (
        f"Salary {batch.payroll_run.period_label}"
    ),
}


#: `(header, source)` pairs. `source` must be a key of FIELD_SOURCES.
#:
#: A neutral default that every bank will need editing away from, and four
#: named starters. They are all CSV because that is what bulk-upload templates
#: overwhelmingly are; a fixed-width bank would need a width per column, which
#: is the obvious next extension of this structure rather than a rewrite.
BANK_FORMATS = {
    "generic": {
        "label": "Generic CSV",
        "include_header": True,
        "columns": [
            ("Account Name", "account_name"),
            ("Account Number", "account_number"),
            ("Account Type", "account_type"),
            ("Branch", "branch"),
            ("Amount", "amount"),
            ("Narration", "narration"),
        ],
    },
    "nic_asia": {
        "label": "NIC Asia",
        "include_header": True,
        "columns": [
            ("AccountNumber", "account_number"),
            ("AccountName", "account_name"),
            ("Amount", "amount"),
            ("Remarks", "narration"),
        ],
    },
    "nabil": {
        "label": "Nabil Bank",
        "include_header": True,
        "columns": [
            ("Beneficiary Account", "account_number"),
            ("Beneficiary Name", "account_name"),
            ("Branch", "branch"),
            ("Amount", "amount"),
        ],
    },
    "global_ime": {
        "label": "Global IME",
        "include_header": True,
        "columns": [
            ("S.N.", "employee_code"),
            ("Account No", "account_number"),
            ("Name", "account_name"),
            ("Amount", "amount"),
            ("Purpose", "narration"),
        ],
    },
    "nbl": {
        "label": "Nepal Bank Limited",
        "include_header": False,
        "columns": [
            ("", "account_number"),
            ("", "account_name"),
            ("", "amount_no_decimals"),
        ],
    },
}


class UnknownBankFormat(ValueError):
    """A format key with no definition. Raised rather than silently falling back
    to `generic`: a file in the wrong layout is rejected by the bank at best,
    and misread at worst."""


def render_batch(batch, format_key="generic"):
    """Render one batch to CSV text.

    Returns a string rather than writing a file, so the caller decides whether
    it becomes a download, an email attachment or an API payload — the same
    bytes either way, which is what makes "what did we send" answerable.
    """
    spec = BANK_FORMATS.get(format_key)
    if spec is None:
        raise UnknownBankFormat(
            f"No layout defined for '{format_key}'. Known: {', '.join(sorted(BANK_FORMATS))}."
        )

    buffer = io.StringIO()
    # QUOTE_MINIMAL and \r\n: bulk-upload templates are consumed by Windows
    # tooling far more often than not, and a bare \n has been rejected before.
    writer = csv.writer(buffer, lineterminator="\r\n")

    if spec["include_header"]:
        writer.writerow([header for header, _ in spec["columns"]])

    for item in batch.items.select_related("payslip__employee").all():
        writer.writerow([
            FIELD_SOURCES[source](item, batch) for _, source in spec["columns"]
        ])

    return buffer.getvalue()


def format_choices():
    """`[(key, label)]` for a picker."""
    return [(key, spec["label"]) for key, spec in sorted(BANK_FORMATS.items())]
