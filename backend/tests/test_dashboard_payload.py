"""What the dashboard promises its cards.

Every figure on that screen comes from one payload, and a card whose field
stops being served does not fail — it renders empty. `payroll_summary.history`
went missing exactly that way: the TypeScript type declared it, the card read
`data.history ?? []` and drew nothing, and no test noticed because the endpoint
still answered 200 with a well-formed body.

So these assert the *shape the cards read*, not just the status code.
"""

from datetime import date
from decimal import Decimal

import pytest

from payroll.models import PayrollRun, Payslip

pytestmark = pytest.mark.django_db

SUMMARY = "/api/v1/dashboard/summary/"


def test_the_payload_carries_every_field_a_card_reads(hr_client, company):
    """One list, kept beside `types/dashboard.ts`.

    A field dropped from the view is a card that renders empty rather than an
    error, which is why this is a list of names rather than a smoke test.
    """
    data = hr_client.get(SUMMARY).data

    for field in (
        "total_employees",
        "today_is_working",
        "present_today",
        "absent_today",
        "on_leave_today",
        "pending_my_approval",
        "attendance_trend",
        "attendance_heatmap",
        "attendance_month",
        "workforce_tenure",
        "leave_usage",
        "leave_breakdown",
        "department_distribution",
        "recent_employees",
        "upcoming_leaves",
        "upcoming_birthdays",
        "on_leave_today_list",
        "recent_checkins",
        "payroll_summary",
    ):
        assert field in data, f"{field} is read by a dashboard card and was not served"


def test_the_payroll_card_gets_its_history_oldest_first(hr_client, company, payroll_setup, admin_user):
    """The sparkline needs a series, and it needs it in reading order.

    One month's net total is a number with nothing to compare it against;
    `MiniBars` exists to put the last half-year beside it. Served newest-first
    the chart reads backwards — an unusual month would look like where the trend
    started rather than where it broke.

    Three runs after the fixture's, with ascending net pay, so the order is
    readable off the values alone.
    """
    emp = payroll_setup["emp"]
    for month in (9, 10, 11):
        run = PayrollRun.objects.create(
            period_calendar="AD",
            period_year=2026,
            period_month=month,
            status=PayrollRun.Status.COMPLETED,
            created_by=admin_user,
        )
        Payslip.objects.create(
            payroll_run=run,
            employee=emp,
            gross_earnings=Decimal("1000"),
            total_deductions=Decimal("0"),
            net_pay=Decimal(str((month - 8) * 100)),
        )

    summary = hr_client.get(SUMMARY).data["payroll_summary"]

    assert summary is not None, "HR must see the payroll card"
    history = summary.get("history")
    assert history, "payroll_summary.history was not served — the sparkline draws nothing"

    labels = [row["period_label"] for row in history]
    assert len(labels) == len(set(labels)), "a run appeared twice"

    nets = [row["net_total"] for row in history]
    assert nets[-3:] == [100.0, 200.0, 300.0], (
        f"expected the three newest runs last and ascending, got {list(zip(labels, nets))}"
    )


def test_history_is_capped_so_the_strip_stays_readable(hr_client, company, admin_user):
    """Six, not every run this company has ever done."""
    for month in range(1, 10):
        PayrollRun.objects.create(
            period_calendar="AD",
            period_year=2026,
            period_month=month,
            status=PayrollRun.Status.COMPLETED,
            created_by=admin_user,
        )

    history = hr_client.get(SUMMARY).data["payroll_summary"]["history"]
    assert len(history) == 6, f"expected the last six runs, got {len(history)}"
