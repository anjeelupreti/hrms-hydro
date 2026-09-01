"""Finance reports over payroll runs.

**Read-only and derived.** Nothing here writes, so running a report cannot
change what was paid — which matters because these are the numbers somebody
will reconcile against a bank statement.

**What is deliberately not here.** The eTDS/IRD and PF filing formats, and the
CIT optimiser, are absent rather than approximated. Each needs a published
specification — the exact column layout the IRD accepts, and the CIT relief rule
that is the *least of three* quantities rather than the flat ceiling we store
today. A report that is the right shape and the wrong figures is worse than no
report, because it gets filed. Same reasoning as D14, and `render_statutory`
below is the seam they slot into when the specs are in hand.
"""

from collections import defaultdict
from decimal import Decimal

from core.calendars import get_calendar
from payroll.models import Loan, PayrollRun
from payroll.periods import period_window


def salary_register(payroll_run):
    """Employee × component grid — the sheet finance actually asks for.

    Columns are derived from the components that **appear in this run**, not
    from every component ever configured: a register padded with columns of
    zeros for components nobody was assigned is harder to read, not more
    complete.
    """
    line_items = (
        payroll_run.payslips.select_related("employee__user")
        .prefetch_related("line_items")
    )

    columns, rows = [], []
    seen = {}

    for payslip in line_items:
        cells = defaultdict(Decimal)
        for item in payslip.line_items.all():
            key = item.component_code
            if key not in seen:
                seen[key] = item.component_name
                columns.append((key, item.component_name, item.component_type))
            # Deductions carry a positive amount and are subtracted in the
            # totals, so the grid shows them as they appear on the payslip
            # rather than inventing a sign convention finance has not asked for.
            cells[key] += item.amount

        user = payslip.employee.user
        rows.append({
            "employee_code": payslip.employee.employee_code,
            "employee_name": user.get_full_name() or user.get_username(),
            "department": payslip.employee.department.name if payslip.employee.department else "",
            "components": dict(cells),
            "gross_earnings": payslip.gross_earnings,
            "total_deductions": payslip.total_deductions,
            "net_pay": payslip.net_pay,
            "is_held": payslip.is_held,
            "status": payslip.status,
        })

    # Earnings first, then deductions, each in configured order — the order a
    # payslip reads in, so the register can be checked against one by eye.
    columns.sort(key=lambda c: (c[2] != "earning", c[1]))
    rows.sort(key=lambda r: r["employee_code"])

    return {
        "period": payroll_run.period_label,
        "columns": [{"code": c, "name": n, "type": t} for c, n, t in columns],
        "rows": rows,
        "totals": {
            "gross_earnings": payroll_run.total_gross,
            "total_deductions": payroll_run.total_deductions,
            "net_pay": payroll_run.total_net,
            "payslip_count": payroll_run.payslip_count,
        },
    }


def cost_by_department(payroll_run):
    """What the period cost, split by department.

    Employees with no department land under an explicit "Unassigned" rather than
    being dropped — a cost breakdown whose parts do not sum to the total is a
    breakdown nobody can trust.
    """
    buckets = defaultdict(lambda: {"gross": Decimal("0"), "net": Decimal("0"), "headcount": 0})

    for payslip in payroll_run.payslips.select_related("employee__department"):
        name = payslip.employee.department.name if payslip.employee.department else "Unassigned"
        buckets[name]["gross"] += payslip.gross_earnings
        buckets[name]["net"] += payslip.net_pay
        buckets[name]["headcount"] += 1

    rows = [
        {"department": name, "gross": v["gross"], "net": v["net"], "headcount": v["headcount"]}
        for name, v in sorted(buckets.items(), key=lambda kv: -kv[1]["gross"])
    ]
    total = sum((r["gross"] for r in rows), Decimal("0"))
    for row in rows:
        # Share of cost, which is the question a department breakdown is
        # actually asked to answer.
        row["share_pct"] = (
            (row["gross"] / total * 100).quantize(Decimal("0.1")) if total else Decimal("0")
        )
    return {"rows": rows, "total_gross": total}


def month_on_month_variance(payroll_run, previous_run=None):
    """This run against the one before it, per employee and in total.

    Variance is the report that catches the mistakes the arithmetic cannot: a
    salary revision applied twice, a leaver still being paid, a structure
    misconfigured. All of those look correct in isolation and obvious next to
    last month.
    """
    if previous_run is None:
        # "The run before this one" means the one whose period *ended* most
        # recently before this period started — not the largest pair of numbers
        # below this pair (D‑06). Ordering on the numbers is only right while
        # every run shares a calendar; a company that switched has runs numbered
        # 2026 and 2083, and the comparison would always pick the Bikram Sambat
        # one however old it was, silently reporting variance against the wrong
        # month.
        this_start, _end, _days = period_window(payroll_run)
        candidates = [
            (period_window(run)[1], run)
            for run in PayrollRun.objects.filter(
                status=PayrollRun.Status.COMPLETED
            ).exclude(pk=payroll_run.pk)
        ]
        earlier = [(end, run) for end, run in candidates if end < this_start]
        previous_run = max(earlier, key=lambda pair: pair[0])[1] if earlier else None

    if previous_run is None:
        # First run ever. Reported as such rather than compared against zero,
        # which would show every employee as a 100% increase.
        return {"previous_period": None, "rows": [], "totals": None}

    current = {
        p.employee_id: p
        for p in payroll_run.payslips.select_related("employee__user")
    }
    prior = {p.employee_id: p for p in previous_run.payslips.all()}

    rows = []
    for employee_id in set(current) | set(prior):
        now = current.get(employee_id)
        before = prior.get(employee_id)
        now_net = now.net_pay if now else Decimal("0")
        before_net = before.net_pay if before else Decimal("0")
        delta = now_net - before_net

        if now is None:
            change = "left"          # paid last month, not this one
        elif before is None:
            change = "joined"        # paid this month, not last
        elif delta == 0:
            change = "unchanged"
        else:
            change = "increased" if delta > 0 else "decreased"

        source = now or before
        user = source.employee.user
        rows.append({
            "employee_code": source.employee.employee_code,
            "employee_name": user.get_full_name() or user.get_username(),
            "previous_net": before_net,
            "current_net": now_net,
            "delta": delta,
            "delta_pct": (
                (delta / before_net * 100).quantize(Decimal("0.1")) if before_net else None
            ),
            "change": change,
        })

    # Largest movements first — the whole point is to look at what moved, and a
    # list sorted by employee code buries it.
    rows.sort(key=lambda r: abs(r["delta"]), reverse=True)

    return {
        "previous_period": previous_run.period_label,
        "rows": rows,
        "totals": {
            "previous_net": previous_run.total_net,
            "current_net": payroll_run.total_net,
            "delta": payroll_run.total_net - previous_run.total_net,
            "joined": sum(1 for r in rows if r["change"] == "joined"),
            "left": sum(1 for r in rows if r["change"] == "left"),
        },
    }


def advances_report():
    """Outstanding loans and advances, company-wide.

    Not scoped to a run: a loan balance is a standing obligation rather than
    something a particular month created.
    """
    loans = (
        Loan.objects.filter(status=Loan.Status.ACTIVE)
        .select_related("employee__user")
        .order_by("-outstanding_balance")
    )
    rows = []
    for loan in loans:
        user = loan.employee.user
        rows.append({
            "employee_code": loan.employee.employee_code,
            "employee_name": user.get_full_name() or user.get_username(),
            "loan_type": loan.get_loan_type_display(),
            "principal": loan.principal_amount,
            "monthly_deduction": loan.monthly_deduction,
            "outstanding": loan.outstanding_balance,
            # How many more runs until it clears, which is the question anybody
            # reading this actually has.
            "months_remaining": (
                int((loan.outstanding_balance / loan.monthly_deduction).to_integral_value(rounding="ROUND_CEILING"))
                if loan.monthly_deduction else None
            ),
        })
    return {
        "rows": rows,
        "total_outstanding": sum((r["outstanding"] for r in rows), Decimal("0")),
        "count": len(rows),
    }


def forecast(months=3, from_run=None):
    """Projected payroll cost for the next few periods.

    **Deliberately naive, and says so.** This carries the latest completed run
    forward, adjusted only for loans that will finish repaying. It does not
    predict hiring, leavers, raises or bonuses — those are decisions, not
    trends, and a forecast that pretends to know them would be a guess wearing a
    number's clothes. What it is good for is "roughly what will leave the bank
    each month if nothing changes", which is the question cash planning asks.
    """
    if from_run is None:
        from_run = (
            PayrollRun.objects.filter(status=PayrollRun.Status.COMPLETED)
            .order_by("-period_year", "-period_month")
            .first()
        )
    if from_run is None:
        return {"basis": None, "rows": []}

    base_net = from_run.total_net
    active_loans = list(
        Loan.objects.filter(status=Loan.Status.ACTIVE).values_list(
            "outstanding_balance", "monthly_deduction"
        )
    )

    rows = []
    # Walked in the basis run's own calendar. Both calendars have twelve
    # months, so the arithmetic is the same — but the *names* are not, and a
    # forecast that labels the months ahead "2026-09" for a company keeping
    # Bikram Sambat books is a forecast they have to translate before using.
    calendar = get_calendar(from_run.period_calendar)
    year, month = from_run.period_year, from_run.period_month
    balances = [[b, d] for b, d in active_loans if d]

    for _step in range(1, months + 1):
        month += 1
        if month > 12:
            month, year = 1, year + 1

        # Loan repayments that finish raise net pay, because the deduction stops.
        finishing = Decimal("0")
        for entry in balances:
            if entry[0] <= 0:
                continue
            take = min(entry[1], entry[0])
            entry[0] -= take
            if entry[0] <= 0:
                finishing += entry[1]

        base_net += finishing
        rows.append({
            "period": f"{calendar.month_name(month)} {year}",
            "projected_net": base_net,
            "loans_completing": finishing,
        })

    return {
        "basis": from_run.period_label,
        "basis_net": from_run.total_net,
        "rows": rows,
        "assumptions": [
            "Headcount unchanged — no joiners, leavers or terminations.",
            "No salary revisions, bonuses or one-off payments.",
            "Attendance and unpaid leave as in the basis period.",
            "Only loan repayments completing are adjusted for.",
        ],
    }


class StatutoryReportFormat:
    """The seam a filing format plugs into.

    Formats are registered rather than written into a function, for the same
    reason bank file layouts are data (`payroll/bank_formats.py`): the IRD
    changes its schedule, a second jurisdiction has its own, and neither should
    require editing the engine.

    **None are registered yet, and that is deliberate.** eTDS/IRD and PF filings
    need their published column specifications; the CIT optimiser needs the
    relief rule that is the *least of three* quantities rather than the flat
    ceiling currently stored. A filing that is the right shape and the wrong
    figures gets submitted, which is worse than one that does not exist.
    """

    registry = {}

    @classmethod
    def register(cls, code, label, renderer):
        cls.registry[code] = {"label": label, "renderer": renderer}

    @classmethod
    def available(cls):
        return [{"code": c, "label": v["label"]} for c, v in sorted(cls.registry.items())]


def render_statutory(payroll_run, code):
    entry = StatutoryReportFormat.registry.get(code)
    if entry is None:
        raise ValueError(
            f"No statutory format '{code}' is registered. "
            f"Available: {', '.join(sorted(StatutoryReportFormat.registry)) or 'none yet'}."
        )
    return entry["renderer"](payroll_run)
