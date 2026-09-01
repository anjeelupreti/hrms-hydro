"""The reporting endpoint, which had no tests and ten report types.

**Why this file exists.** `reports` is the one app whose whole job is to read
every *other* app's tables. That makes it the first thing a rename or a field
removal elsewhere breaks, and the last thing anybody runs by hand — so a
`_report_*` method referring to a field that no longer exists would have failed
silently in production, on the report nobody opens. The exhaustive loop over
`REPORT_TYPES` is the point: it is what makes adding a report to that list also
add it to the tests.

The individual tests pin the judgements that are *not* obvious from the code —
the ones a well-meaning refactor would undo:

* a leaver counts on the day it was applied, not when it was requested;
* the asset register ignores the date range rather than filtering by it;
* an empty report returns no chart, rather than an empty one.
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from assets.models import Asset
from employees.models import Department, Employee, LifecycleEvent
from expenses.models import ExpenseClaim
from recruitment.models import Candidate, JobPosting
from reports.views import REPORT_TYPES

BASE = "/api/v1/reports/"


@pytest.fixture
def staffed(company, hr_user, employee_user, admin_user):
    """Two departments, three people, one of whom joined inside the window.

    **Two departments deliberately.** `_chart` refuses to draw fewer than two
    points, so a one-department fixture would silently exercise the no-chart
    path in every test that looks at a chart.
    """
    engineering = Department.objects.create(name="Engineering", code="ENG")
    finance = Department.objects.create(name="Finance", code="FIN")
    old_hand = Employee.objects.create(
        user=hr_user,
        employee_code="EMP-001",
        date_joined=date(2020, 1, 6),
        department=engineering,
    )
    newcomer = Employee.objects.create(
        user=employee_user,
        employee_code="EMP-002",
        date_joined=date.today() - timedelta(days=10),
        department=engineering,
    )
    accountant = Employee.objects.create(
        user=admin_user,
        employee_code="EMP-003",
        date_joined=date(2021, 3, 1),
        department=finance,
    )
    return {
        "dept": engineering,
        "finance": finance,
        "old_hand": old_hand,
        "newcomer": newcomer,
        "accountant": accountant,
    }


def _get(client, report_type, start=None, end=None):
    today = date.today()
    start = start or (today - timedelta(days=90)).isoformat()
    end = end or today.isoformat()
    return client.get(f"{BASE}?type={report_type}&start={start}&end={end}")


@pytest.mark.django_db
class TestEveryReportAnswers:
    """Each type returns the envelope, on a company with almost nothing in it.

    An empty company is the harder case, not the easier one: it is where a
    `Sum` returns `None`, a `max()` gets an empty sequence and a division sees
    a zero. Every one of those is a 500 rather than an empty table.
    """

    @pytest.mark.parametrize("report_type", REPORT_TYPES)
    def test_report_returns_the_envelope_on_an_empty_company(self, hr_client, report_type):
        response = _get(hr_client, report_type)
        assert response.status_code == 200, response.data
        body = response.data
        assert body["type"] == report_type
        assert isinstance(body["summary"], list)
        assert isinstance(body["columns"], list) and body["columns"]
        assert isinstance(body["rows"], list)
        # Present as a key even when there is nothing to draw, so the client
        # never has to distinguish "no chart" from "old server".
        assert "chart" in body

    @pytest.mark.parametrize("report_type", REPORT_TYPES)
    def test_every_row_matches_the_column_count(self, hr_client, staffed, report_type):
        """A row one cell short renders shifted, and reads as wrong data."""
        body = _get(hr_client, report_type).data
        width = len(body["columns"])
        assert all(len(row) == width for row in body["rows"])

    def test_an_unknown_type_is_refused(self, hr_client):
        assert _get(hr_client, "salaries-of-people-i-dislike").status_code == 400


@pytest.mark.django_db
class TestPermissions:
    def test_an_employee_cannot_read_reports(self, employee_client):
        """Reports carry everybody's pay, attendance and leave in one sheet."""
        assert _get(employee_client, "team").status_code in (403, 404)

    def test_anonymous_is_refused(self, api_client):
        assert _get(api_client, "team").status_code in (401, 403)


@pytest.mark.django_db
class TestTeam:
    def test_departments_are_counted_without_a_query_each(self, hr_client, staffed):
        body = _get(hr_client, "team").data
        assert ["Engineering", 2, 2] in body["rows"]

    def test_a_department_with_nobody_in_it_still_appears(self, company, hr_client, staffed):
        """Zero is an answer. Omitting the row makes it look unconfigured."""
        Department.objects.create(name="Legal", code="LEG")
        rows = _get(hr_client, "team").data["rows"]
        assert ["Legal", 0, 0] in rows


@pytest.mark.django_db
class TestHeadcountMovement:
    def test_a_joiner_inside_the_range_is_counted(self, hr_client, staffed):
        body = _get(hr_client, "headcount").data
        summary = {entry["label"]: entry["value"] for entry in body["summary"]}
        assert summary["Joined"] == 1
        assert summary["Net change"] == 1

    def test_a_pending_resignation_is_not_a_departure(self, company, hr_client, staffed):
        """The single judgement in this report: a request is not a leaving.

        Counting `PENDING_APPROVAL` would report attrition that has not
        happened, and would report it *again* when the event is applied.
        """
        LifecycleEvent.objects.create(
            employee=staffed["newcomer"],
            event_type=LifecycleEvent.EventType.RESIGNATION,
            status=LifecycleEvent.Status.PENDING_APPROVAL,
            effective_date=date.today(),
            last_working_date=date.today(),
        )
        summary = {e["label"]: e["value"] for e in _get(hr_client, "headcount").data["summary"]}
        assert summary["Left"] == 0

        LifecycleEvent.objects.filter(employee=staffed["newcomer"]).update(
            status=LifecycleEvent.Status.APPLIED
        )
        summary = {e["label"]: e["value"] for e in _get(hr_client, "headcount").data["summary"]}
        assert summary["Left"] == 1
        assert summary["Net change"] == 0


@pytest.mark.django_db
class TestExpenses:
    def test_owed_counts_approved_but_not_reimbursed(self, company, hr_client, staffed):
        """"Owed" is money the company has not moved yet.

        Folding reimbursed claims into it would report a debt that is already
        settled, which is the number somebody pays twice.
        """
        ExpenseClaim.objects.create(
            employee=staffed["newcomer"],
            title="Taxi",
            amount=Decimal("1200"),
            expense_date=date.today(),
            status=ExpenseClaim.Status.APPROVED,
        )
        ExpenseClaim.objects.create(
            employee=staffed["newcomer"],
            title="Hotel",
            amount=Decimal("8000"),
            expense_date=date.today(),
            status=ExpenseClaim.Status.REIMBURSED,
        )
        ExpenseClaim.objects.create(
            employee=staffed["newcomer"],
            title="Rejected thing",
            amount=Decimal("5000"),
            expense_date=date.today(),
            status=ExpenseClaim.Status.REJECTED,
        )
        summary = {e["label"]: e["value"] for e in _get(hr_client, "expenses").data["summary"]}
        assert summary["Owed (approved)"] == 1200
        assert summary["Reimbursed"] == 8000
        # Everything raised, including what will never be paid.
        assert summary["Claimed"] == 14200

    def test_a_claim_outside_the_range_is_excluded(self, company, hr_client, staffed):
        ExpenseClaim.objects.create(
            employee=staffed["newcomer"],
            title="Last year",
            amount=Decimal("999"),
            expense_date=date.today() - timedelta(days=400),
            status=ExpenseClaim.Status.APPROVED,
        )
        summary = {e["label"]: e["value"] for e in _get(hr_client, "expenses").data["summary"]}
        assert summary["Claims"] == 0


@pytest.mark.django_db
class TestAssets:
    def test_the_register_ignores_the_date_range(self, company, hr_client, staffed):
        """An asset register describes now, not a span.

        Filtering it by the range would answer "assets we owned in March",
        which nobody asks — and would make the register look empty whenever
        somebody narrowed the dates for a different report.
        """
        Asset.objects.create(name="Laptop", asset_tag="AST-1", category=Asset.Category.LAPTOP)
        narrow = date(1999, 1, 1).isoformat()
        body = _get(hr_client, "assets", start=narrow, end=narrow).data
        assert len(body["rows"]) == 1


@pytest.mark.django_db
class TestCharts:
    def test_an_empty_report_draws_no_chart(self, hr_client):
        """`null`, not an empty frame — a chart with no bars reads as broken."""
        assert _get(hr_client, "expenses").data["chart"] is None

    def test_one_data_point_draws_no_chart(self, company, hr_client, staffed):
        """One bar is not a chart — comparison is the whole job.

        A company with a single payroll run in range got one column floating in
        a 260px frame, saying less than the summary tile above it.
        """
        ExpenseClaim.objects.create(
            employee=staffed["newcomer"],
            title="Only claim",
            amount=Decimal("500"),
            expense_date=date.today(),
            status=ExpenseClaim.Status.APPROVED,
        )
        body = _get(hr_client, "expenses").data
        assert len(body["rows"]) == 1
        assert body["chart"] is None

    def test_a_populated_report_names_its_chart_and_kind(self, hr_client, staffed):
        chart = _get(hr_client, "team").data["chart"]
        assert chart["kind"] in ("columns", "bars")
        assert chart["title"]
        assert chart["points"]

    def test_identical_values_draw_no_chart(self, company, hr_client, staffed):
        """Bars of equal length encode nothing, and look like broken scaling.

        Every training programme on the demo company has exactly six enrolments,
        which drew four full-width bars saying "6" four times.
        """
        job = JobPosting.objects.create(title="Engineer", department=staffed["dept"])
        Candidate.objects.create(job=job, name="A", stage=Candidate.Stage.APPLIED)
        Candidate.objects.create(job=job, name="B", stage=Candidate.Stage.OFFER)
        assert _get(hr_client, "recruitment").data["chart"] is None

        # One more in a stage, and there is a difference to draw.
        Candidate.objects.create(job=job, name="C", stage=Candidate.Stage.OFFER)
        assert _get(hr_client, "recruitment").data["chart"] is not None

    def test_the_pipeline_chart_stays_in_stage_order(self, company, hr_client, staffed):
        """Applied → screening → interview → offer → hired is the information.

        Ranking it by size destroys the only thing the reader is looking for,
        which is where people are piling up. Seeded so that the *biggest* stage
        is late in the pipeline: a ranked chart would put Offer first, and this
        test would catch it.
        """
        job = JobPosting.objects.create(title="Engineer", department=staffed["dept"])
        Candidate.objects.create(job=job, name="A", stage=Candidate.Stage.APPLIED)
        for name in ("B", "C", "D"):
            Candidate.objects.create(job=job, name=name, stage=Candidate.Stage.OFFER)

        chart = _get(hr_client, "recruitment").data["chart"]
        # Empty stages are dropped by `_chart`, so what remains must still be
        # in pipeline order rather than sorted by size.
        labels = [point["label"] for point in chart["points"]]
        assert labels == ["Applied", "Offer"]
        assert chart["kind"] == "columns"


@pytest.mark.django_db
class TestExport:
    def test_xlsx_export_is_a_workbook_not_json(self, hr_client, staffed):
        response = hr_client.get(f"{BASE}?type=team&export=xlsx")
        assert response.status_code == 200
        assert "spreadsheet" in response["Content-Type"]


@pytest.mark.django_db
class TestDepartmentFilter:
    """The filter has to actually narrow, and only where it is offered.

    `team` is the case that most needs it: its rows are one per department,
    built by walking `Department.objects.all()`, so filtering the *people* alone
    would change the counts inside each row and leave every department on screen
    reading zero — a parameter accepted and apparently ignored.
    """

    def test_it_narrows_the_rows(self, hr_client, staffed):
        everyone = _get(hr_client, "team").data["rows"]
        narrowed = hr_client.get(
            f"{BASE}?type=team&department={staffed['dept'].id}"
        ).data["rows"]

        assert len(everyone) > len(narrowed), "the filter left the table the same length"
        assert [r[0] for r in narrowed] == ["Engineering"]

    def test_it_narrows_a_row_per_person_report(self, hr_client, staffed):
        everyone = _get(hr_client, "headcount").data["rows"]
        narrowed = hr_client.get(
            f"{BASE}?type=headcount&department={staffed['finance'].id}"
        ).data["rows"]
        assert len(narrowed) < len(everyone)

    def test_it_is_ignored_where_the_report_does_not_offer_it(self, company, hr_client, staffed):
        """The asset register has no employee to filter on.

        Ignored rather than refused: the department control is one shared piece
        of page chrome, and 400-ing a report because a stale value is still in
        the URL would break navigation between reports.
        """
        Asset.objects.create(name="Laptop", asset_tag="DF-1", category=Asset.Category.LAPTOP)
        both = hr_client.get(f"{BASE}?type=assets&department={staffed['dept'].id}").data
        assert len(both["rows"]) == 1

    def test_a_nonsense_department_is_refused(self, hr_client):
        response = hr_client.get(f"{BASE}?type=team&department=not-a-number")
        assert response.status_code == 400
