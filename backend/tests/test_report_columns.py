"""Every report's column headers must be unique, and match its rows.

Two columns with the same label is a real fault on a table somebody reconciles
against: the statutory report shipped `["Employee", "Scheme", "Period",
"Employee", "Employer", "Total"]`, where the first "Employee" is the person and
the fourth is their share of the contribution. A reader checking an SSF figure
sees the same word over two different numbers.

It also gave the screen two React children with the same key, which makes React
reconcile by position — the cells render, then swap under a re-render. That is
how it was noticed, but the duplicate label was the fault underneath.

Checked across every report rather than the one that broke, because the next
one to add a column is the next one to do this.
"""

import pytest
from django.utils import timezone

from reports.views import REPORT_TYPES

pytestmark = pytest.mark.django_db

START = "2026-01-01"


@pytest.mark.parametrize("report_type", REPORT_TYPES)
def test_report_columns_are_unique_and_match_the_rows(report_type, company, hr_client):
    """Headers unique, and every row exactly as wide as the header."""
    end = timezone.localdate().isoformat()
    response = hr_client.get(
        f"/api/v1/reports/?type={report_type}&start={START}&end={end}"
    )
    assert response.status_code == 200, f"{report_type} did not build"

    columns = response.data["columns"]
    assert columns, f"{report_type} returned no columns"

    duplicates = {c for c in columns if columns.count(c) > 1}
    assert not duplicates, (
        f"{report_type} has repeated column headers {sorted(duplicates)} — "
        f"ambiguous to read, and duplicate React keys on the table head"
    )

    # A row wider or narrower than the header is the other way this table
    # misleads: the values silently shift under the wrong titles.
    for i, row in enumerate(response.data["rows"][:20]):
        assert len(row) == len(columns), (
            f"{report_type} row {i} has {len(row)} cells against "
            f"{len(columns)} columns"
        )
