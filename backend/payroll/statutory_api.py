"""The statutory figures, made reachable.

**Why this file exists.** `StatutoryRate` held eleven legislated figures — SSF
and PF on both sides, gratuity, the retirement relief ceilings and fraction, the
two insurance ceilings, the female rebate, the minimum wage — and had **no
viewset and no route**. So the claim that every statutory figure is
configuration was true of the design and false of the product: a rate nobody can
edit is a constant with extra steps, and the company would have had to ring us to
change a percentage set by somebody else's budget speech.

**Verification is an action, not a field.** `is_verified` is what separates a
shipped placeholder from a figure an accountant checked, and if it were
writable alongside `value` then whoever edited a number could mark their own
edit as verified in the same request. It is the education-record rule applied to
money: the thing being verified must not set its own verification.

**Editing a figure never restates history.** Rates are keyed by fiscal year, and
payslips already computed keep the figures they were computed with — a
correction applies to what has not been run yet. That is what effective dating
is *for*, and there is now a test saying so.
"""

from django_filters import rest_framework as django_filters
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin, UpdateModelMixin
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from accounts.permissions import IsHRAdmin
from accounts.policy import Perm
from core.viewsets import AuditViewSetMixin
from payroll.models import EmployeeSchemeEnrolment, StatutoryRate
from payroll.serializers import (
    EmployeeSchemeEnrolmentSerializer,
    StatutoryRateSerializer,
)


class StatutoryRateViewSet(
    AuditViewSetMixin, ListModelMixin, RetrieveModelMixin, UpdateModelMixin, GenericViewSet
):
    """Read and correct the legislated figures.

    **No create and no destroy.** The set of rates is a property of the country
    pack, not of the company: a rate this codebase has never heard of would be
    read by nothing, and deleting one would silently drop a contribution rather
    than set it to zero. Adding a year's figures is `seed`, below.
    """

    serializer_class = StatutoryRateSerializer
    permission_classes = [IsAuthenticated, IsHRAdmin]
    #: Read by the permission class. These figures decide what leaves people's
    #: pay, so they sit behind the payroll capability rather than a general one.
    required_permission = Perm.PAYROLL_RUN
    filter_backends = [django_filters.DjangoFilterBackend]
    filterset_fields = ["fiscal_year", "code", "is_verified"]
    ordering = ["fiscal_year", "code"]

    def get_queryset(self):
        return StatutoryRate.objects.select_related("verified_by").order_by(
            "-fiscal_year", "code"
        )

    @action(detail=True, methods=["post"])
    def verify(self, request, *args, **kwargs):
        """Mark a figure as checked against the law, with where it came from.

        **The source is required.** "Verified" with no citation is an assertion
        nobody can re-check, which is the state the flag exists to distinguish
        from. Six months later the person who ticked it will not remember, and
        the person who needs to know will not be them.
        """
        from django.utils import timezone

        source = (request.data.get("source") or "").strip()
        if not source:
            return Response(
                {"source": "Say where this figure came from, e.g. 'Finance Act 2082, Schedule 1'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        rate = self.get_object()
        rate.is_verified = True
        rate.verified_by = request.user
        rate.verified_at = timezone.now()
        rate.source = source[:255]
        rate.updated_by = request.user
        rate.save(
            update_fields=["is_verified", "verified_by", "verified_at", "source", "updated_by", "updated_at"]
        )
        return Response(self.get_serializer(rate).data)

    @action(detail=True, methods=["post"])
    def unverify(self, request, *args, **kwargs):
        """Withdraw a verification — §R2, and the reason it matters here.

        A figure marked verified in error must not stand forever: the whole
        value of the flag is that it means somebody checked, so an unwithdrawable
        tick is one nobody can trust. The source is kept rather than cleared,
        because what was *claimed* is part of the record.
        """
        rate = self.get_object()
        rate.is_verified = False
        rate.verified_by = None
        rate.verified_at = None
        rate.updated_by = request.user
        rate.save(
            update_fields=["is_verified", "verified_by", "verified_at", "updated_by", "updated_at"]
        )
        return Response(self.get_serializer(rate).data)

    @action(detail=False, methods=["post"])
    def seed(self, request, *args, **kwargs):
        """Create any missing figures for a fiscal year.

        **Never overwrites.** Re-running after somebody has entered and verified
        the real numbers must not put the placeholders back — so this fills gaps
        and leaves everything else alone. It is how a company gets next year's
        table without hand-typing eleven rows.
        """
        from datetime import date

        from core.calendars import fiscal_year_for
        from payroll.statutory import seed_statutory_rates, seed_tax_slabs

        raw = request.data.get("fiscal_year")
        try:
            fiscal_year = int(raw) if raw is not None else fiscal_year_for(date.today())
        except (TypeError, ValueError):
            return Response(
                {"fiscal_year": "Give a fiscal year as a number, e.g. 2082."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        rates = seed_statutory_rates(fiscal_year)
        # The slab table ships with the rates: a company with rates and no slabs
        # cannot run payroll at all, which was the state every real company was
        # in before the pack included them.
        slabs = seed_tax_slabs(fiscal_year)
        return Response(
            {
                "fiscal_year": fiscal_year,
                "rates_created": rates,
                "slabs_created": len(slabs),
                # Said plainly, because a seed that silently did nothing looks
                # identical to one that worked.
                "detail": (
                    f"{len(rates)} rate(s) and {len(slabs)} tax band(s) added for "
                    f"{fiscal_year}. Existing figures were left untouched."
                ),
            }
        )


class EmployeeSchemeEnrolmentViewSet(AuditViewSetMixin, ModelViewSet):
    """Who differs from the company scheme, and how.

    **Deleting a row is a real removal, not a state change** — and that is
    correct here, unusually. The row records a *deviation* from the company
    default; removing it means "this person follows the company again", which
    is a return to normal rather than a loss of history. What actually happened
    to their pay lives in `ContributionRecord`, which is never deleted.

    Opting somebody out is `is_active=False` rather than deleting, because
    "outside the scheme" and "follows the company" are different answers and
    only one of them stops contributions.
    """

    serializer_class = EmployeeSchemeEnrolmentSerializer
    permission_classes = [IsAuthenticated, IsHRAdmin]
    required_permission = Perm.PAYROLL_RUN
    filter_backends = [django_filters.DjangoFilterBackend]
    filterset_fields = ["employee", "scheme", "is_active"]

    def get_queryset(self):
        return EmployeeSchemeEnrolment.objects.select_related("employee__user")


class ContributionSummaryView(GenericViewSet, ListModelMixin):
    """How much has gone into each scheme — the figure that had no answer.

    Not a `ModelViewSet` over `ContributionRecord`: nobody wants the rows, they
    want the totals. Serving the rows would make every caller sum them, which
    is the client-side-total mistake §2.6 exists to stop.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = EmployeeSchemeEnrolmentSerializer  # unused; DRF wants one

    def list(self, request, *args, **kwargs):
        """Totals for one employee and one fiscal year.

        **Your own by default, somebody else's only if you manage payroll.**
        What a colleague contributes to CIT is a fact about their savings, and
        the directory is not the place to learn it.
        """
        from datetime import date

        from accounts.policy import can
        from attendance.permissions import _requesting_employee
        from core.calendars import fiscal_year_for
        from employees.models import Employee
        from payroll.schemes import totals_to_date

        me = _requesting_employee(request.user)
        requested = request.query_params.get("employee")

        if requested is None or (me is not None and str(me.id) == requested):
            employee = me
        elif can(request.user, Perm.PAYROLL_VIEW) or can(request.user, Perm.PAYROLL_RUN):
            employee = Employee.objects.filter(pk=requested).first()
        else:
            return Response(
                {"detail": "You can only see your own contributions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if employee is None:
            # No employment record, or no such employee. Empty totals rather
            # than a 404 — a portal asking for them should render, not break.
            return Response({"fiscal_year": None, "schemes": []})

        raw = request.query_params.get("fiscal_year")
        try:
            fiscal_year = int(raw) if raw else fiscal_year_for(date.today())
        except (TypeError, ValueError):
            return Response(
                {"fiscal_year": "Give a fiscal year as a number, e.g. 2082."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "employee": employee.id,
                "fiscal_year": fiscal_year,
                "schemes": totals_to_date(employee, fiscal_year),
            }
        )


class ContributionReportView(GenericViewSet, ListModelMixin):
    """Everybody's contributions for a year — what gets filed and reconciled.

    Payroll-gated in both directions: a per-employee contribution list is a
    picture of what every colleague earns and saves, so unlike the individual
    summary there is no "your own" fallback. Either you run payroll or this is
    not your report.
    """

    permission_classes = [IsAuthenticated, IsHRAdmin]
    required_permission = Perm.PAYROLL_VIEW
    serializer_class = StatutoryRateSerializer  # unused; DRF wants one

    def list(self, request, *args, **kwargs):
        from datetime import date

        from core.calendars import fiscal_year_for
        from payroll.schemes import company_totals

        raw = request.query_params.get("fiscal_year")
        try:
            fiscal_year = int(raw) if raw else fiscal_year_for(date.today())
        except (TypeError, ValueError):
            return Response(
                {"fiscal_year": "Give a fiscal year as a number, e.g. 2082."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        payload = company_totals(fiscal_year, request.query_params.get("scheme"))
        return Response({"fiscal_year": fiscal_year, **payload})


class TaxPlannerView(GenericViewSet, ListModelMixin):
    """"What will my tax be, and what would saving more do to it?"

    **Own only.** Somebody else's projected tax is a picture of their salary,
    and there is no reason for a colleague to hold it — so unlike most payroll
    surfaces this takes no `?employee=` at all, even for HR. HR reads a
    person's actual figures on their record; a projection of somebody else's
    take-home is not a thing the product should answer.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = StatutoryRateSerializer  # unused; DRF wants one

    def list(self, request, *args, **kwargs):
        from datetime import date
        from decimal import Decimal, InvalidOperation

        from attendance.permissions import _requesting_employee
        from core.calendars import fiscal_year_for
        from payroll.planner import projection

        employee = _requesting_employee(request.user)
        if employee is None:
            return Response({"available": False, "reason": "no_employee_record"})

        raw_extra = request.query_params.get("extra_cit") or "0"
        try:
            extra = Decimal(raw_extra)
        except (InvalidOperation, TypeError):
            return Response(
                {"extra_cit": "Give an amount as a number."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if extra < 0:
            return Response(
                {"extra_cit": "An amount cannot be negative."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_year = request.query_params.get("fiscal_year")
        try:
            fiscal_year = int(raw_year) if raw_year else fiscal_year_for(date.today())
        except (TypeError, ValueError):
            return Response(
                {"fiscal_year": "Give a fiscal year as a number, e.g. 2082."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(projection(employee, fiscal_year, extra))
