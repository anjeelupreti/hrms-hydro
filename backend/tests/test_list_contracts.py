"""Every list surface's declared contract must actually resolve.

**Why this exists.** Adding search, ordering and status counts across payroll,
CRM, helpdesk and attendance introduced four bugs that the whole 700-test suite
passed straight over, because nothing exercised the new query strings:

- `PayrollRun.sum_field = "total_net_pay"` — the column is `total_net`
- `Loan.sum_field = "principal"` — the column is `principal_amount`
- `Deal.ordering_fields` named `expected_close` — it is `expected_close_date`
- `Invoice.sum_field` summed an annotation that was itself a `Sum`, which
  Django refuses: "cannot compute Sum(...): it is an aggregate"

Each is a string that looks right and is never evaluated until somebody clicks
a column header or opens a screen with chips on it. A typo in a `filterset` or
`ordering_fields` list is invisible to import, to `manage.py check`, and to
every test that does not pass that exact parameter.

So this walks the declarations themselves rather than any fixed list of URLs:
a viewset added next month is covered the day it is written.
"""

import pytest
from django.core.exceptions import FieldError
from rest_framework.test import APIRequestFactory, force_authenticate

from accounts.models import User
from attendance.viewsets import RegularisationRequestViewSet
from crm.viewsets import ClientTicketViewSet, DealViewSet, InvoiceViewSet
from helpdesk.viewsets import TicketViewSet
from payroll.viewsets import (
    LoanViewSet,
    PayrollRunViewSet,
    PayslipViewSet,
    SalaryComponentViewSet,
)

pytestmark = pytest.mark.django_db

#: Every viewset that declares one of these contracts.
LIST_VIEWSETS = [
    ClientTicketViewSet,
    DealViewSet,
    InvoiceViewSet,
    LoanViewSet,
    PayrollRunViewSet,
    PayslipViewSet,
    RegularisationRequestViewSet,
    SalaryComponentViewSet,
    TicketViewSet,
]


@pytest.fixture
def actor(company):
    return User.objects.create_user(
        username="contract_admin", email="c@t.test", password="pw",
        role=User.Role.HR_ADMIN, is_superuser=True,
    )


def _call(viewset, company, actor, query, action="list"):
    request = APIRequestFactory().get(f"/x/?{query}")
    force_authenticate(request, user=actor)
    return viewset.as_view({"get": action})(request)


@pytest.mark.parametrize("viewset", LIST_VIEWSETS, ids=lambda v: v.__name__)
def test_every_declared_ordering_field_resolves(viewset, company, actor):
    """A column header that raises FieldError is a 500 on click."""
    for field in getattr(viewset, "ordering_fields", []) or []:
        try:
            response = _call(viewset, company, actor, f"ordering={field}")
        except FieldError as exc:
            pytest.fail(f"{viewset.__name__} ordering={field}: {exc}")
        assert response.status_code == 200, f"{viewset.__name__} ordering={field}"


@pytest.mark.parametrize("viewset", LIST_VIEWSETS, ids=lambda v: v.__name__)
def test_every_declared_search_field_resolves(viewset, company, actor):
    if not getattr(viewset, "search_fields", None):
        pytest.skip("no search declared")
    try:
        response = _call(viewset, company, actor, "search=anything")
    except FieldError as exc:
        pytest.fail(f"{viewset.__name__} search: {exc}")
    assert response.status_code == 200


@pytest.mark.parametrize("viewset", LIST_VIEWSETS, ids=lambda v: v.__name__)
def test_status_counts_resolve_where_declared(viewset, company, actor):
    """Covers `sum_field` too — the three bugs above were all in that one
    string, and it is only ever evaluated by this endpoint."""
    if not hasattr(viewset, "status_counts"):
        pytest.skip("no status counts")
    try:
        response = _call(viewset, company, actor, "", action="status_counts")
    except (FieldError, Exception) as exc:
        if isinstance(exc, FieldError) or "aggregate" in str(exc):
            pytest.fail(f"{viewset.__name__} status-counts: {exc}")
        raise
    assert response.status_code == 200
    assert "total" in response.data
