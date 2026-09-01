from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from django.db.models import Count, Sum
from django.db.models.functions import TruncMonth
from django.http import FileResponse, Http404
from django.utils import timezone
from django_filters import rest_framework as django_filters
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.mixins import CreateModelMixin, ListModelMixin, RetrieveModelMixin
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from accounts.permissions import IsHRAdmin
from accounts.policy import Perm, can
from attendance.permissions import _requesting_employee
from core.exports import XlsxExportMixin
from core.viewsets import AuditViewSetMixin
from expenses import budgets, services
from expenses.models import ExpenseBudget, ExpenseClaim
from expenses.serializers import (
    ExpenseBudgetSerializer,
    ExpenseClaimSerializer,
    ExpenseDecisionSerializer,
    ReimburseSerializer,
)


def _is_hr(user):
    """Thin adapter over the one policy (accounts/policy.py).

    Kept as a local name so every call site in this file reads the same
    as it did; what it *means* is now decided in one place rather than
    re-derived here.
    """
    return can(user, Perm.EXPENSES_MANAGE)


class ExpenseClaimViewSet(
    XlsxExportMixin, AuditViewSetMixin, ListModelMixin, RetrieveModelMixin, CreateModelMixin, GenericViewSet
):
    serializer_class = ExpenseClaimSerializer
    permission_classes = [IsAuthenticated]
    # `SearchFilter` has to be named explicitly: the project's
    # DEFAULT_FILTER_BACKENDS is DjangoFilterBackend alone, so `search_fields`
    # on its own is silently inert.
    filter_backends = [django_filters.DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["status", "category", "employee"]
    # A claim is looked for by what it was for, or by whose it is.
    search_fields = ["title", "description", "employee__user__first_name", "employee__user__last_name", "employee__employee_code"]

    export_filename = "expense-claims.xlsx"
    export_title = "Expense Claims"
    export_headers = ["Employee", "Title", "Category", "Amount", "Date", "Status"]
    export_highlight_header = "Status"
    export_validations = {"Status": ["Pending", "Approved", "Rejected", "Reimbursed", "Cancelled"]}

    def get_export_rows(self, queryset):
        return [
            [
                c.employee.user.get_full_name() or c.employee.user.get_username(),
                c.title,
                c.get_category_display(),
                str(c.amount),
                c.expense_date.isoformat(),
                c.get_status_display(),
            ]
            for c in queryset
        ]

    def get_queryset(self):
        qs = ExpenseClaim.objects.select_related("employee__user", "employee__department", "decided_by")
        if _is_hr(self.request.user):
            return qs
        employee = _requesting_employee(self.request.user)
        return qs.filter(employee=employee) if employee else qs.none()

    def create(self, request, *args, **kwargs):
        employee = _requesting_employee(request.user)
        if employee is None:
            return Response(
                {"detail": "Your account has no employee profile to claim against."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Checked before the row is written, so a refused claim leaves nothing
        # behind. A budget that only bites at approval time means somebody
        # fills in a form, attaches a receipt, waits three days and is then
        # told the money was never there.
        verdict = budgets.check(
            employee,
            category=serializer.validated_data.get("category", ExpenseClaim.Category.OTHER),
            amount=serializer.validated_data["amount"],
            on_date=serializer.validated_data["expense_date"],
        )
        if not verdict.allowed:
            return Response(
                {"detail": verdict.message, "code": "over_budget"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        claim = serializer.save(employee=employee, created_by=request.user, updated_by=request.user)
        services.submit_claim(claim)
        data = self.get_serializer(claim).data
        # Carried on the created claim rather than swallowed: the submitter is
        # entitled to know their claim went in over budget, and the approver
        # needs it on the record rather than in a notification they may miss.
        if verdict.warn:
            data["budget_warning"] = verdict.message
        return Response(data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="check-budget")
    def check_budget(self, request, *args, **kwargs):
        """What a claim *would* run into, before anybody fills the form in.

        The form calls this as the amount and category change, so the ceiling
        is visible while somebody is deciding what to claim rather than after
        they have pressed Submit.
        """
        employee = _requesting_employee(request.user)
        if employee is None:
            return Response({"allowed": True, "warn": False, "message": ""})
        try:
            amount = Decimal(str(request.data.get("amount") or "0"))
        except (InvalidOperation, TypeError):
            return Response({"allowed": True, "warn": False, "message": ""})

        raw_date = request.data.get("expense_date")
        try:
            on_date = date.fromisoformat(raw_date) if raw_date else timezone.localdate()
        except ValueError:
            on_date = timezone.localdate()

        verdict = budgets.check(
            employee,
            category=request.data.get("category") or ExpenseClaim.Category.OTHER,
            amount=amount,
            on_date=on_date,
        )
        return Response({
            "allowed": verdict.allowed,
            "warn": verdict.warn,
            "message": verdict.message,
            # Same shape as every other money field in the API — see the note
            # on `ExpenseBudgetSerializer.spent`.
            "remaining": f"{verdict.remaining:.2f}" if verdict.remaining is not None else None,
            "budget": verdict.budget.name if verdict.budget else None,
        })

    def _hr_guard(self, request):
        return None if _is_hr(request.user) else Response(status=status.HTTP_403_FORBIDDEN)

    @action(detail=False, methods=["get"], url_path="status-counts", pagination_class=None)
    def status_counts(self, request, *args, **kwargs):
        """Claim counts and totals per status, for the filter chips.

        Server-side for the same reason as the employee directory: the page
        was tallying `data.results`, which is one clamped page, so on a company
        with more than 100 claims the "pending" figure quietly undercounted —
        and that is the number someone acts on.

        Amounts travel with the counts because a claims list is judged by money
        as much as by volume.
        """
        queryset = self.get_queryset()
        rows = queryset.values("status").annotate(n=Count("id"), amount=Sum("amount"))
        by_status = {r["status"]: r for r in rows}
        return Response(
            {
                "total": sum(r["n"] for r in rows),
                **{
                    choice: {
                        "count": by_status.get(choice, {}).get("n", 0),
                        "amount": str(by_status.get(choice, {}).get("amount") or 0),
                    }
                    for choice, _ in ExpenseClaim.Status.choices
                },
            }
        )

    @action(detail=True, methods=["post"])
    def approve(self, request, **kwargs):
        if (resp := self._hr_guard(request)) is not None:
            return resp
        claim = self.get_object()
        if claim.status != ExpenseClaim.Status.PENDING:
            return Response({"detail": "Only a pending claim can be approved."}, status=status.HTTP_400_BAD_REQUEST)
        ser = ExpenseDecisionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        services.approve_claim(claim, actor=request.user, note=ser.validated_data["note"])
        return Response(self.get_serializer(self.get_object()).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, **kwargs):
        if (resp := self._hr_guard(request)) is not None:
            return resp
        claim = self.get_object()
        if claim.status != ExpenseClaim.Status.PENDING:
            return Response({"detail": "Only a pending claim can be rejected."}, status=status.HTTP_400_BAD_REQUEST)
        ser = ExpenseDecisionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        services.reject_claim(claim, actor=request.user, note=ser.validated_data["note"])
        return Response(self.get_serializer(self.get_object()).data)

    @action(detail=True, methods=["post"])
    def reimburse(self, request, **kwargs):
        if (resp := self._hr_guard(request)) is not None:
            return resp
        claim = self.get_object()
        if claim.status != ExpenseClaim.Status.APPROVED:
            return Response(
                {"detail": "Only an approved claim can be marked reimbursed."}, status=status.HTTP_400_BAD_REQUEST
            )
        ser = ReimburseSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        services.reimburse_claim(claim, actor=request.user, reference=ser.validated_data["reference"])
        return Response(self.get_serializer(self.get_object()).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, **kwargs):
        claim = self.get_object()
        is_owner = claim.employee.user_id == request.user.id
        if not (is_owner or _is_hr(request.user)):
            return Response(status=status.HTTP_403_FORBIDDEN)
        if claim.status not in (ExpenseClaim.Status.PENDING, ExpenseClaim.Status.APPROVED):
            return Response({"detail": "This claim can no longer be cancelled."}, status=status.HTTP_400_BAD_REQUEST)
        services.cancel_claim(claim, actor=request.user)
        return Response(self.get_serializer(self.get_object()).data)

    @action(detail=True, methods=["get"])
    def receipt(self, request, **kwargs):
        claim = self.get_object()  # get_queryset already scopes visibility
        if not claim.receipt:
            raise Http404("No receipt attached.")
        return FileResponse(claim.receipt.open("rb"), as_attachment=True, filename=claim.receipt.name.split("/")[-1])


    @action(detail=False, methods=["get"])
    def trend(self, request, *args, **kwargs):
        """What was spent per month, and on what, over the last twelve months.

        **The expenses screen had three totals and no shape.** Pending,
        approved-awaiting-reimbursement and reimbursed — all of them counts as
        of today, none of them able to answer whether this month is normal. A
        single month's spend is a number with nothing to compare it to, which is
        the same gap the payroll card had.

        **Reimbursed and approved both count as spend.** The company has agreed
        to the money either way; whether the transfer has cleared is a treasury
        question, not a spending one, and excluding approved claims would make
        the current month look artificially light every time.

        **Rejected claims are excluded** — they are not spend, and including
        them would inflate exactly the categories where scrutiny is highest.
        """
        today = timezone.localdate()
        start = (today.replace(day=1) - timedelta(days=365)).replace(day=1)

        counted = [ExpenseClaim.Status.APPROVED, ExpenseClaim.Status.REIMBURSED]
        rows = (
            self.get_queryset()
            .filter(status__in=counted, expense_date__gte=start)
            .annotate(month=TruncMonth("expense_date"))
            .values("month", "category")
            .annotate(total=Sum("amount"))
            .order_by("month")
        )

        labels = dict(ExpenseClaim.Category.choices)

        # Built from the calendar: a month nobody claimed in is a real answer,
        # and dropping it would make the series lie about its own spacing.
        buckets: dict[str, dict] = {}
        cursor = start
        while cursor <= today:
            buckets[cursor.isoformat()] = {"month": cursor.isoformat(), "total": 0.0}
            cursor = (cursor + timedelta(days=32)).replace(day=1)

        categories: dict[str, float] = {}
        for row in rows:
            raw = row["month"]
            key = (raw.date() if hasattr(raw, "date") else raw).isoformat()
            bucket = buckets.setdefault(key, {"month": key, "total": 0.0})
            name = labels.get(row["category"], row["category"])
            amount = float(row["total"] or 0)
            bucket[name] = bucket.get(name, 0.0) + amount
            bucket["total"] += amount
            categories[name] = categories.get(name, 0.0) + amount

        return Response(
            {
                # Ordered by spend, so the chart's colour assignment is stable
                # and the biggest category is always the first series.
                "categories": [
                    {"name": name, "total": total}
                    for name, total in sorted(categories.items(), key=lambda kv: -kv[1])
                ],
                "months": [buckets[k] for k in sorted(buckets)],
            }
        )


class ExpenseBudgetViewSet(AuditViewSetMixin, ModelViewSet):
    """The ceilings, and how close each one is.

    Readable by anyone with `expenses.manage` — an approver deciding on a claim
    needs to see what is left, and hiding it would make the refusal message the
    only place the number ever appears. Setting one is an admin act; an officer
    may keep the figures current.
    """

    serializer_class = ExpenseBudgetSerializer
    permission_classes = [IsAuthenticated, IsHRAdmin]
    required_permission = Perm.EXPENSES_MANAGE
    filter_backends = [django_filters.DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["category", "department", "employee", "period", "is_active"]
    ordering_fields = ["name", "amount"]

    def get_queryset(self):
        return ExpenseBudget.objects.select_related("department", "employee__user")
