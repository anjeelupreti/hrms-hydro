from django.db.models import Count, Q, Sum
from django.http import FileResponse, Http404, HttpResponse
from django.utils import timezone
from django_filters import rest_framework as django_filters
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.mixins import (
    CreateModelMixin,
    DestroyModelMixin,
    ListModelMixin,
    RetrieveModelMixin,
)
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from accounts.policy import Perm, can
from attendance.permissions import _requesting_employee
from core.counts import StatusCountsMixin
from core.filters import IdsLookupMixin
from core.removal import SafeDestroyMixin
from core.viewsets import AuditViewSetMixin
from documents.models import Document
from employees.models import Employee
from documents.services import latest_document_for
from payroll.bank_formats import UnknownBankFormat, format_choices, render_batch
from payroll.disbursement import (
    BankDeliveryError,
    DisbursementError,
    build_payment_batches,
    build_single_payment,
    email_batch_to_bank,
)
from payroll.models import (
    Loan,
    PaymentBatch,
    PayrollRun,
    Payslip,
    SalaryComponent,
    SalaryStructure,
    SalaryTemplate,
    TaxSlab,
)
from payroll.permissions import IsHRAdmin
from payroll.templates_service import (
    TemplateError,
    apply_template,
    employees_without_structure,
)
from payroll.reports import (
    StatutoryReportFormat,
    advances_report,
    cost_by_department,
    forecast,
    month_on_month_variance,
    salary_register,
)
from payroll.serializers import (
    ApplyTemplateSerializer,
    LoanCreateSerializer,
    LoanDecisionSerializer,
    LoanSerializer,
    MarkPaidSerializer,
    PaymentBatchSerializer,
    PaymentExclusionSerializer,
    PayrollRunSerializer,
    PayslipLineItemsUpdateSerializer,
    PayslipSerializer,
    SalaryComponentSerializer,
    SalaryStructureSerializer,
    SalaryTemplateSerializer,
    TaxSlabSerializer,
)
from payroll.services import activate_loan, apply_loan_repayments, compute_payslip, set_payslip_line_items
from payroll.tasks import notify_payslip_finalized, regenerate_payslip_pdf, run_payroll


class SalaryComponentViewSet(IdsLookupMixin, SafeDestroyMixin, AuditViewSetMixin, ModelViewSet):
    queryset = SalaryComponent.objects.all()
    serializer_class = SalaryComponentSerializer
    # A component picker is the `percentage_of` field on another component, and
    # a structure's line items. Both need to search past the first page and
    # both need to label an already-chosen row — `IdsLookupMixin` is what makes
    # the chip keep its name while the user types something that excludes it.
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_fields = ["component_type", "calc_type", "is_active"]
    search_fields = ["code", "name"]
    ordering_fields = ["order", "name", "code"]
    ordering = ["order", "name"]
    permission_classes = [IsAuthenticated, IsHRAdmin]
    #: Gate 5 — the capability this gates on. Without it the permission
    #: class falls back to `people.manage`, so an officer granted people
    #: management but deliberately not payroll could still reach this.
    required_permission = Perm.PAYROLL_RUN
    # Salary structure lines point at components with PROTECT, so deleting one
    # that is in use is refused with the count rather than a 500.
    removal_label = "salary component"


class TaxSlabViewSet(AuditViewSetMixin, ModelViewSet):
    queryset = TaxSlab.objects.all()
    serializer_class = TaxSlabSerializer
    permission_classes = [IsAuthenticated, IsHRAdmin]
    #: Gate 5 — the capability this gates on. Without it the permission
    #: class falls back to `people.manage`, so an officer granted people
    #: management but deliberately not payroll could still reach this.
    required_permission = Perm.PAYROLL_RUN
    filter_backends = [django_filters.DjangoFilterBackend]
    filterset_fields = ["fiscal_year"]


class SalaryStructureViewSet(AuditViewSetMixin, ListModelMixin, RetrieveModelMixin, CreateModelMixin, GenericViewSet):
    """No update/partial_update — a change means a new effective-dated row,
    never editing history in place (see the model docstring)."""

    serializer_class = SalaryStructureSerializer
    permission_classes = [IsAuthenticated, IsHRAdmin]
    #: Gate 5 — the capability this gates on. Without it the permission
    #: class falls back to `people.manage`, so an officer granted people
    #: management but deliberately not payroll could still reach this.
    required_permission = Perm.PAYROLL_RUN
    filter_backends = [django_filters.DjangoFilterBackend]
    filterset_fields = ["employee"]

    def get_queryset(self):
        return SalaryStructure.objects.select_related("employee").prefetch_related("assignments__component")


class SalaryTemplateViewSet(AuditViewSetMixin, ModelViewSet):
    """Named pay structures, and the action that puts people on them.

    **Full CRUD, unlike `SalaryStructureViewSet` above** — and the contrast is
    deliberate rather than an inconsistency. A structure is the record of what
    somebody was actually paid from when, so it is never edited in place. A
    template is a starting point that has paid nobody: editing it changes
    nothing that has already happened, because applying it *copies* its lines
    and the copy keeps no link back.
    """

    serializer_class = SalaryTemplateSerializer
    permission_classes = [IsAuthenticated, IsHRAdmin]
    required_permission = Perm.PAYROLL_RUN

    def get_queryset(self):
        return SalaryTemplate.objects.prefetch_related("lines__component")

    @action(detail=False, methods=["get"], url_path="unassigned", pagination_class=None)
    def unassigned(self, request, *args, **kwargs):
        """Active employees with no salary structure at all.

        The number that makes "align everyone" a decision somebody can take
        rather than a guess. Counted server-side over the whole workforce —
        counting a page in the browser would understate it on any company past
        the page cap, and understating *this* number means quietly leaving
        people unpaid.
        """
        people = employees_without_structure().select_related("user", "department")
        return Response(
            {
                "count": people.count(),
                "employees": [
                    {
                        "id": e.pk,
                        "employee_code": e.employee_code,
                        "name": e.user.get_full_name() or e.user.get_username(),
                        "department": e.department.name if e.department else None,
                    }
                    for e in people[:200]
                ],
            }
        )

    @action(detail=True, methods=["post"])
    def apply(self, request, *args, **kwargs):
        """Stamp this template onto people, effective from a date.

        With no `employees`, it means everybody active who is not on pay yet —
        the setting-up case. The response is a per-person report rather than a
        count, because "97 done, 3 skipped" is the answer somebody needs and
        "done" is the answer that hides a problem until payday.
        """
        serializer = ApplyTemplateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        ids = data.get("employees")
        if ids:
            people = list(Employee.objects.filter(pk__in=ids))
            missing = set(ids) - {e.pk for e in people}
            if missing:
                return Response(
                    {"employees": f"No such employee: {sorted(missing)}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            people = list(employees_without_structure())

        if not people:
            return Response(
                {"detail": "Everybody active is already on a salary structure."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            report = apply_template(
                self.get_object(),
                people,
                effective_from=data["effective_from"],
                replace_existing=data["replace_existing"],
            )
        except TemplateError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(report.as_dict(), status=status.HTTP_200_OK)


class PayrollRunViewSet(
    StatusCountsMixin,
    AuditViewSetMixin,
    ListModelMixin,
    RetrieveModelMixin,
    CreateModelMixin,
    DestroyModelMixin,
    GenericViewSet,
):
    """No update/partial_update — a run's status only ever moves forward via
    the `run`/`finalize` actions below, never a raw PATCH.

    `destroy` exists, but only for a **draft** — creating a run for the wrong
    month is an easy mistake and needs an undo. Once a run is processed its
    payslips are the record of what people were paid, which is the archetypal
    thing that must not be deletable."""

    # Error count annotated rather than serialised per row: without this,
    # listing runs issues one COUNT per run, which is the N+1 the denormalised
    # `payslip_count` column was added to avoid in the first place.
    queryset = PayrollRun.objects.annotate(
        unresolved_error_count=Count("errors", filter=Q(errors__resolved_at__isnull=True))
    )
    serializer_class = PayrollRunSerializer
    permission_classes = [IsAuthenticated, IsHRAdmin]
    #: Gate 5. Running payroll is its own capability — separate from people
    #: management on purpose, because approving somebody's leave and paying
    #: them are different authorities.
    required_permission = Perm.PAYROLL_RUN
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.OrderingFilter,
    ]
    filterset_fields = ["status", "period_year", "period_calendar"]
    ordering_fields = ["period_year", "period_month", "created_at", "total_net"]
    # Newest first: a payroll screen is opened to look at the run in progress,
    # not at the oldest one on record.
    ordering = ["-period_year", "-period_month"]
    sum_field = "total_net"

    def destroy(self, request, *args, **kwargs):
        payroll_run = self.get_object()
        if payroll_run.status != PayrollRun.Status.DRAFT:
            return Response(
                {
                    "detail": (
                        f"This run is {payroll_run.get_status_display().lower()}, so it can no "
                        "longer be deleted — its payslips are the record of what was paid. "
                        "Only a draft run can be removed."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def run(self, request, *args, **kwargs):
        payroll_run = self.get_object()
        if payroll_run.status != PayrollRun.Status.DRAFT:
            return Response(
                {"detail": "Only a draft run can be started."}, status=status.HTTP_400_BAD_REQUEST
            )
        run_payroll.delay(payroll_run.id)
        payroll_run.status = PayrollRun.Status.PROCESSING
        payroll_run.updated_by = request.user
        payroll_run.save(update_fields=["status", "updated_by", "updated_at"])
        return Response(PayrollRunSerializer(payroll_run).data)

    @action(detail=True, methods=["get"])
    def stats(self, request, *args, **kwargs):
        """What the run cost, beyond the totals already on the row.

        **Median as well as average, deliberately.** Payroll distributions are
        skewed — a handful of senior salaries pull the mean well above what a
        typical person earns, so quoting the average alone overstates the
        middle. The two together say whether the spread is wide, which is the
        actually useful signal; either alone can mislead.
        """
        payroll_run = self.get_object()
        nets = list(
            payroll_run.payslips.order_by("net_pay").values_list("net_pay", flat=True)
        )

        median = None
        if nets:
            middle = len(nets) // 2
            median = (
                nets[middle]
                if len(nets) % 2
                # Even count: the mean of the two central values, not an
                # arbitrary pick of one side.
                else (nets[middle - 1] + nets[middle]) / 2
            )

        outstanding = Loan.objects.filter(status=Loan.Status.ACTIVE).aggregate(
            total=Sum("outstanding_balance"), count=Count("id")
        )

        return Response({
            "payslip_count": payroll_run.payslip_count,
            "total_gross": payroll_run.total_gross,
            "total_deductions": payroll_run.total_deductions,
            "total_net": payroll_run.total_net,
            "average_net": (sum(nets) / len(nets)) if nets else None,
            "median_net": median,
            "highest_net": nets[-1] if nets else None,
            "lowest_net": nets[0] if nets else None,
            "held_count": payroll_run.payslips.filter(is_held=True).count(),
            "unresolved_errors": payroll_run.errors.filter(resolved_at__isnull=True).count(),
            # Company-wide rather than per-run: a loan balance is a standing
            # obligation, not something this month's run created.
            "outstanding_loan_balance": outstanding["total"] or 0,
            "active_loan_count": outstanding["count"] or 0,
        })


    # ── Disbursement (§5.5) ──────────────────────────────────────────────

    # ── Finance reports (§5.4) ───────────────────────────────────────────

    @action(detail=True, methods=["get"], url_path="register")
    def register(self, request, *args, **kwargs):
        """Employee × component grid — the sheet finance asks for."""
        return Response(salary_register(self.get_object()))

    @action(detail=True, methods=["get"], url_path="cost-by-department")
    def cost_by_department_report(self, request, *args, **kwargs):
        return Response(cost_by_department(self.get_object()))

    @action(detail=True, methods=["get"])
    def variance(self, request, *args, **kwargs):
        """This run against the one before it.

        Catches what the arithmetic cannot: a revision applied twice, a leaver
        still being paid, a misconfigured structure. Each looks correct alone
        and obvious beside last month.
        """
        return Response(month_on_month_variance(self.get_object()))

    @action(detail=True, methods=["post"], url_path="build-payments")
    def build_payments(self, request, *args, **kwargs):
        """Group the run's payable payslips into one instruction per bank.

        Idempotent — rebuilding after fixing somebody's bank details is the
        normal correction workflow, and batches already sent are left alone.
        """
        payroll_run = self.get_object()
        try:
            batches, exclusions = build_payment_batches(payroll_run, actor=request.user)
        except DisbursementError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)

        return Response({
            "batches": PaymentBatchSerializer(batches, many=True).data,
            # Returned alongside, not buried behind a second request: whoever
            # builds the file needs to see who is *not* in it before sending.
            "excluded": PaymentExclusionSerializer(
                payroll_run.payment_exclusions.select_related("payslip__employee__user"),
                many=True,
            ).data,
        })

    @action(detail=True, methods=["get"], url_path="payments")
    def payments(self, request, *args, **kwargs):
        payroll_run = self.get_object()
        return Response({
            "batches": PaymentBatchSerializer(
                payroll_run.payment_batches.prefetch_related("items__payslip__employee"),
                many=True,
            ).data,
            "excluded": PaymentExclusionSerializer(
                payroll_run.payment_exclusions.select_related("payslip__employee__user"),
                many=True,
            ).data,
            "formats": [{"key": k, "label": v} for k, v in format_choices()],
        })

    @action(detail=True, methods=["post"])
    def finalize(self, request, *args, **kwargs):
        """HR has reviewed a COMPLETED run — locks its payslips as
        FINALIZED (ready for disbursement marking) and notifies employees."""
        payroll_run = self.get_object()
        if payroll_run.status != PayrollRun.Status.COMPLETED:
            return Response(
                {"detail": "Only a completed run can be finalized."}, status=status.HTTP_400_BAD_REQUEST
            )

        # The guard that makes recording errors safe rather than permissive.
        # A run that computed with known failures is not approvable: finalising
        # locks the period, so it would freeze a payroll that is missing
        # somebody's payslip. Named, not counted — "3 errors" sends HR looking.
        unresolved = payroll_run.errors.filter(resolved_at__isnull=True).select_related("employee")
        if unresolved.exists():
            return Response(
                {
                    "detail": "This run has unresolved errors and cannot be finalized.",
                    "code": "payroll_errors_unresolved",
                    "errors": [
                        {"employee_code": e.employee.employee_code, "message": e.message}
                        for e in unresolved
                    ],
                },
                status=status.HTTP_409_CONFLICT,
            )

        # `is_verified` on `StatutoryRate` and `TaxSlab` is what separates a
        # figure somebody checked against the Finance Act from one that arrived
        # as a default. This is where it is enforced: payroll cannot be
        # finalised on unverified numbers.
        #
        # Blocked rather than warned, and with no override. Finalising locks the
        # period; there is no "undo" to fall back on, and an override would be
        # taken every time by whoever is in a hurry — which is everybody on
        # payroll day. Verifying is one click per row on
        # `/payroll/statutory-rates`, and it is the exact action that should
        # happen before anybody is paid on these numbers.
        #
        # Named, not counted, for the same reason the error guard above names
        # its rows.
        from core.calendars import fiscal_year_for
        from payroll.periods import period_window
        from payroll.statutory import unverified_figures

        try:
            period_start, _end, _days = period_window(payroll_run)
            run_fiscal_year = fiscal_year_for(period_start)
        except Exception:  # noqa: BLE001 — fall back to the run's own year
            run_fiscal_year = payroll_run.period_year

        unverified = unverified_figures(run_fiscal_year)
        if unverified:
            return Response(
                {
                    "detail": (
                        f"{len(unverified)} statutory figures for FY {run_fiscal_year} "
                        "have not been checked against the Finance Act. Verify them "
                        "before finalising — finalising locks the period."
                    ),
                    "code": "statutory_unverified",
                    "fiscal_year": run_fiscal_year,
                    "figures": unverified,
                },
                status=status.HTTP_409_CONFLICT,
            )

        draft_payslips = payroll_run.payslips.filter(status=Payslip.Status.DRAFT)
        payslip_ids = list(draft_payslips.values_list("id", flat=True))
        draft_payslips.update(status=Payslip.Status.FINALIZED, updated_by=request.user)

        # Close the period. Finalising is the moment the figures stop being a
        # proposal, so it is also the moment recomputation has to stop being
        # possible — otherwise a re-delivered task or a retry could restate
        # them from data that has since moved on.
        payroll_run.locked_at = timezone.now()
        payroll_run.locked_by = request.user
        payroll_run.save(update_fields=["locked_at", "locked_by", "updated_at"])

        for payslip_id in payslip_ids:
            # Reprint the PDF from the (possibly HR-edited) final figures,
            # then notify the employee.
            regenerate_payslip_pdf.delay(payslip_id)
            notify_payslip_finalized.delay(payslip_id)
        return Response(PayrollRunSerializer(payroll_run).data)

    @action(detail=True, methods=["get"])
    def payslips(self, request, *args, **kwargs):
        payroll_run = self.get_object()
        qs = payroll_run.payslips.select_related("employee__user")
        return Response(PayslipSerializer(qs, many=True).data)

    @action(detail=True, methods=["get"], url_path="bank-file")
    def bank_file(self, request, *args, **kwargs):
        """Group disbursement: a styled bank salary file for the run —
        one row per payable employee (net pay + their bank details) for
        upload to the bank's corporate portal. This is how salaries are
        actually credited; gateways have no payout API (see README)."""
        from core.exports import xlsx_response

        payroll_run = self.get_object()
        payslips = (
            payroll_run.payslips.exclude(status=Payslip.Status.DRAFT)
            .select_related("employee__user")
            .order_by("employee__employee_code")
        )
        headers = ["Employee Code", "Account Name", "Bank", "Account Number", "Amount", "Status"]
        rows = []
        for p in payslips:
            emp = p.employee
            rows.append([
                emp.employee_code,
                emp.bank_account_name or (emp.user.get_full_name() or emp.user.get_username()),
                emp.bank_name,
                emp.bank_account_number,
                str(p.net_pay),
                p.get_status_display(),
            ])
        period = f"{payroll_run.period_calendar}-{payroll_run.period_year}-{payroll_run.period_month:02d}"
        return xlsx_response(
            f"salary-bankfile-{period}.xlsx",
            headers,
            rows,
            title=f"Salary Disbursement — {period}",
            subtitle="Upload to your bank's corporate portal for bulk salary credit.",
        )

    @action(detail=True, methods=["post"], url_path="mark-all-paid")
    def mark_all_paid(self, request, *args, **kwargs):
        """Group disbursement: mark every FINALIZED payslip in the run PAID
        in one action (records manual settlement, same as per-payslip)."""
        payroll_run = self.get_object()
        serializer = MarkPaidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Held payslips are excluded, which is the entire point of a hold: this
        # is the bulk action a hold exists to survive. Without the exclusion the
        # flag would be decoration — visible on screen and ignored by the one
        # operation that moves money.
        finalized = payroll_run.payslips.filter(status=Payslip.Status.FINALIZED).exclude(is_held=True)
        held_count = payroll_run.payslips.filter(
            status=Payslip.Status.FINALIZED, is_held=True
        ).count()
        count = finalized.update(
            status=Payslip.Status.PAID,
            disbursement_method=serializer.validated_data["disbursement_method"],
            disbursement_reference=serializer.validated_data["disbursement_reference"],
            paid_at=timezone.now(),
            updated_by=request.user,
        )
        # Reported rather than silently omitted — "42 paid" when 45 were
        # expected is a discrepancy someone has to chase; "42 paid, 3 held" is
        # an answer.
        return Response({"marked_paid": count, "skipped_held": held_count})


class PayslipViewSet(StatusCountsMixin, ListModelMixin, RetrieveModelMixin, GenericViewSet):
    serializer_class = PayslipSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    # `is_held` is filterable, which is the "Held" view the checklist asked for
    # — a filter rather than a separate endpoint, so it composes with run and
    # employee instead of being a third way to list the same rows.
    filterset_fields = ["payroll_run", "employee", "status", "is_held"]
    # A payslip is looked up by the person, not by its id. Searching the
    # employee's name and code is the only way this list is ever navigated on a
    # company with a hundred people and a hundred payslips a month.
    search_fields = [
        "employee__employee_code",
        "employee__user__first_name",
        "employee__user__last_name",
    ]
    ordering_fields = ["net_pay", "gross_earnings", "total_deductions", "employee__employee_code"]
    ordering = ["employee__employee_code"]
    # The chips above the list: how many are draft, finalised, paid, held —
    # and what each bucket is *worth*, because a payroll list is judged by
    # amount at least as much as by row count.
    sum_field = "net_pay"

    @action(detail=True, methods=["post"])
    def hold(self, request, *args, **kwargs):
        """Stop a payslip being disbursed, without discarding its status.

        HR-only: holding somebody's pay is not a self-service action.
        """
        if not can(request.user, Perm.PAYROLL_RUN):
            return Response(status=status.HTTP_403_FORBIDDEN)

        payslip = self.get_object()
        if payslip.status == Payslip.Status.PAID:
            # Holding after payment would claim to have stopped something that
            # already left. Reversing a payment is a different operation.
            return Response(
                {"detail": "This payslip is already paid and can no longer be held."},
                status=status.HTTP_409_CONFLICT,
            )

        payslip.is_held = True
        payslip.hold_reason = request.data.get("reason", "")
        payslip.held_by = request.user
        payslip.held_at = timezone.now()
        # Cleared so the record reads as the *current* hold rather than
        # carrying the previous release alongside it.
        payslip.released_by = None
        payslip.released_at = None
        payslip.save(update_fields=[
            "is_held", "hold_reason", "held_by", "held_at",
            "released_by", "released_at", "updated_at",
        ])
        return Response(PayslipSerializer(payslip).data)

    @action(detail=True, methods=["post"])
    def release(self, request, *args, **kwargs):
        """Lift a hold. The payslip returns to whatever status it already had —
        which is the reason hold is a flag and not a status."""
        if not can(request.user, Perm.PAYROLL_RUN):
            return Response(status=status.HTTP_403_FORBIDDEN)

        payslip = self.get_object()
        if not payslip.is_held:
            return Response(
                {"detail": "This payslip is not held."}, status=status.HTTP_400_BAD_REQUEST
            )

        payslip.is_held = False
        payslip.released_by = request.user
        payslip.released_at = timezone.now()
        # `hold_reason`, `held_by` and `held_at` are kept: why pay was withheld
        # and who withheld it is exactly the history an audit asks for.
        payslip.save(update_fields=["is_held", "released_by", "released_at", "updated_at"])
        return Response(PayslipSerializer(payslip).data)

    def get_queryset(self):
        qs = Payslip.objects.select_related("employee__user", "payroll_run").prefetch_related("line_items")
        user = self.request.user
        if can(user, Perm.PAYROLL_RUN):
            return qs
        employee = _requesting_employee(user)
        if employee is None:
            return qs.none()
        # Employees never see DRAFT payslips — those are a working
        # computation HR hasn't reviewed yet, not a real paycheck figure.
        return qs.filter(employee=employee).exclude(status=Payslip.Status.DRAFT)


    @action(detail=True, methods=["post"], url_path="pay")
    def pay(self, request, *args, **kwargs):
        """Put one payslip into a payment batch, outside the run-wide build.

        Lives on the payslip rather than the run because that is the thing being
        paid — a correction or a late joiner is about one person, and requiring
        a run-wide rebuild to pay them would disturb batches that have already
        gone to the bank.
        """
        if not can(request.user, Perm.PAYROLL_RUN):
            return Response(status=status.HTTP_403_FORBIDDEN)

        payslip = self.get_object()
        try:
            batch = build_single_payment(payslip, actor=request.user)
        except DisbursementError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        return Response(PaymentBatchSerializer(batch).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRAdmin])
    def mark_paid(self, request, *args, **kwargs):
        payslip = self.get_object()
        if payslip.status != Payslip.Status.FINALIZED:
            return Response(
                {"detail": "Only a finalized payslip can be marked paid."}, status=status.HTTP_400_BAD_REQUEST
            )
        serializer = MarkPaidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payslip.status = Payslip.Status.PAID
        payslip.disbursement_method = serializer.validated_data["disbursement_method"]
        payslip.disbursement_reference = serializer.validated_data["disbursement_reference"]
        payslip.paid_at = timezone.now()
        payslip.updated_by = request.user
        payslip.save(
            update_fields=[
                "status",
                "disbursement_method",
                "disbursement_reference",
                "paid_at",
                "updated_by",
                "updated_at",
            ]
        )
        return Response(PayslipSerializer(payslip).data)

    @action(
        detail=True,
        methods=["put"],
        url_path="line-items",
        permission_classes=[IsAuthenticated, IsHRAdmin],
    )
    def edit_line_items(self, request, *args, **kwargs):
        """Replace a DRAFT payslip's line items with an HR-edited set and
        recompute totals. Blocked once the payslip is finalized — a
        payslip is made ready only once and is immutable after that."""
        payslip = self.get_object()
        if payslip.status != Payslip.Status.DRAFT:
            return Response(
                {"detail": "This payslip has been finalized and can no longer be edited."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = PayslipLineItemsUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        set_payslip_line_items(payslip, serializer.validated_data["line_items"], actor=request.user)
        return Response(PayslipSerializer(payslip).data)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsAuthenticated, IsHRAdmin],
    )
    def recompute(self, request, *args, **kwargs):
        """Discard HR edits and re-prefill the draft from the employee's
        salary structure (the auto computation). DRAFT only."""
        payslip = self.get_object()
        if payslip.status != Payslip.Status.DRAFT:
            return Response(
                {"detail": "Only a draft payslip can be recomputed."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        payslip = compute_payslip(payslip.payroll_run, payslip.employee)
        apply_loan_repayments(payslip)
        return Response(PayslipSerializer(payslip).data)

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsAuthenticated, IsHRAdmin],
    )
    def finalize(self, request, *args, **kwargs):
        """Make a single payslip ready (DRAFT -> FINALIZED). This is the
        once-only lock: the figures become immutable, the PDF is
        reprinted from them, and the employee is notified."""
        payslip = self.get_object()
        if payslip.status != Payslip.Status.DRAFT:
            return Response(
                {"detail": "Only a draft payslip can be finalized."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        payslip.status = Payslip.Status.FINALIZED
        payslip.updated_by = request.user
        payslip.save(update_fields=["status", "updated_by", "updated_at"])
        regenerate_payslip_pdf.delay(payslip.id)
        notify_payslip_finalized.delay(payslip.id)
        return Response(PayslipSerializer(payslip).data)

    @action(detail=True, methods=["get"])
    def download(self, request, *args, **kwargs):
        """The payslip PDF, generating it now if it does not exist yet.

        **Why it generates here rather than only in a task.** The PDF is
        normally rendered by a Celery job when a run finalises, and a plain 404
        when that has not happened conflates three unrelated situations: the
        worker is not running, the job failed, or the run was never finalised.
        Acme had 190 payslips and zero PDFs, and every one of them answered
        "not generated yet" — which is true, useless, and identical in all
        three cases.

        Rendering on demand collapses two of those: if it can be made, it is
        made, and the person gets their payslip. If it cannot, the reason
        travels back instead of a bare 404.
        """
        payslip = self.get_object()
        document = latest_document_for(payslip, kind=Document.Kind.PAYSLIP)

        if document is None:
            from payroll.pdf import generate_payslip_pdf

            try:
                document = generate_payslip_pdf(payslip, actor=request.user)
            except OSError as exc:
                # WeasyPrint renders through Pango and Cairo, which are native
                # libraries pip cannot install. On a machine without GTK the
                # import fails with a bare `cannot load library` — a message
                # about a .dll, shown to somebody who wanted their payslip.
                return Response(
                    {
                        "detail": (
                            "The PDF renderer is not available on this server. "
                            "WeasyPrint needs the GTK runtime libraries, which are "
                            "installed separately from the Python packages."
                        ),
                        "cause": str(exc),
                    },
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
            except Exception as exc:  # noqa: BLE001 — the reason must reach the caller
                return Response(
                    {"detail": f"The payslip PDF could not be generated: {exc}"},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

        if document is None:
            raise Http404("No PDF has been generated for this payslip yet.")
        return FileResponse(document.file.open("rb"), as_attachment=True, filename=document.original_filename)

    @action(
        detail=True,
        methods=["post"],
        url_path="regenerate-pdf",
        permission_classes=[IsAuthenticated, IsHRAdmin],
    )
    def regenerate_pdf(self, request, *args, **kwargs):
        """Retries PDF rendering for a payslip whose figures were already
        computed but whose PDF failed to generate (e.g. a transient
        WeasyPrint/environment issue) — see payroll/tasks.py."""
        payslip = self.get_object()
        regenerate_payslip_pdf.delay(payslip.id)
        return Response({"detail": "PDF regeneration dispatched."}, status=status.HTTP_202_ACCEPTED)


class LoanViewSet(StatusCountsMixin, ListModelMixin, RetrieveModelMixin, CreateModelMixin, GenericViewSet):
    """Office/Personal loan requests — employee self-service, HR approval.
    Approval wires the monthly deduction into the employee's salary
    structure (payroll.services.activate_loan); repayment is tracked
    automatically each payroll run (services.apply_loan_repayments)."""

    serializer_class = LoanSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_fields = ["employee", "loan_type", "status"]
    search_fields = [
        "employee__employee_code",
        "employee__user__first_name",
        "employee__user__last_name",
    ]
    ordering_fields = ["principal_amount", "outstanding_balance", "created_at", "status"]
    ordering = ["-created_at"]
    # What is still owed, not what was originally lent — a loans list is
    # asked "how much is outstanding", and the principal of a closed loan
    # inflates that by the part already repaid.
    sum_field = "outstanding_balance"

    def get_queryset(self):
        qs = Loan.objects.select_related("employee__user")
        user = self.request.user
        if can(user, Perm.PAYROLL_RUN):
            return qs
        employee = _requesting_employee(user)
        if employee is None:
            return qs.none()
        return qs.filter(employee=employee)

    def create(self, request, *args, **kwargs):
        employee = _requesting_employee(request.user)
        if employee is None:
            return Response(
                {"detail": "Your account has no employee profile."}, status=status.HTTP_400_BAD_REQUEST
            )
        serializer = LoanCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        loan = Loan.objects.create(
            employee=employee,
            created_by=request.user,
            updated_by=request.user,
            **serializer.validated_data,
        )
        return Response(LoanSerializer(loan).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRAdmin])
    def approve(self, request, *args, **kwargs):
        loan = self.get_object()
        if loan.status != Loan.Status.REQUESTED:
            return Response({"detail": "Only a requested loan can be approved."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = LoanDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        loan.status = Loan.Status.APPROVED
        loan.updated_by = request.user
        loan.save(update_fields=["status", "updated_by", "updated_at"])
        activate_loan(loan, actor=request.user)
        return Response(LoanSerializer(loan).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRAdmin])
    def reject(self, request, *args, **kwargs):
        loan = self.get_object()
        if loan.status != Loan.Status.REQUESTED:
            return Response({"detail": "Only a requested loan can be rejected."}, status=status.HTTP_400_BAD_REQUEST)
        loan.status = Loan.Status.REJECTED
        loan.updated_by = request.user
        loan.save(update_fields=["status", "updated_by", "updated_at"])
        return Response(LoanSerializer(loan).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, *args, **kwargs):
        """Withdraw a loan request that has not been paid out.

        The borrower can withdraw their own request, HR can withdraw anyone's.
        Refused once the loan is ACTIVE: approval wires the monthly deduction
        into the employee's salary structure and repayment may already have
        started, so unwinding it is a payroll correction, not a list edit.
        """
        loan = self.get_object()
        is_owner = loan.employee.user_id == request.user.id
        is_hr = can(request.user, Perm.PAYROLL_RUN)
        if not (is_owner or is_hr):
            return Response(status=status.HTTP_403_FORBIDDEN)
        if loan.status != Loan.Status.REQUESTED:
            return Response(
                {
                    "detail": (
                        "Only a loan that is still awaiting a decision can be withdrawn. "
                        "An active loan has to be closed through payroll."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )
        loan.status = Loan.Status.REJECTED
        loan.updated_by = request.user
        loan.save(update_fields=["status", "updated_by", "updated_at"])
        return Response(LoanSerializer(loan).data)


class PaymentBatchViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    """A bank instruction, from built to acknowledged.

    HR-only throughout: this is the surface that moves money.
    """

    serializer_class = PaymentBatchSerializer
    permission_classes = [IsAuthenticated, IsHRAdmin]
    #: Gate 5 — the capability this gates on. Without it the permission
    #: class falls back to `people.manage`, so an officer granted people
    #: management but deliberately not payroll could still reach this.
    required_permission = Perm.PAYROLL_RUN
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_fields = ["payroll_run", "status", "bank_name"]
    search_fields = ["bank_name", "reference"]
    ordering_fields = ["created_at", "total_amount", "bank_name"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return PaymentBatch.objects.select_related("payroll_run").prefetch_related(
            "items__payslip__employee__user"
        )

    @action(detail=True, methods=["get"])
    def download(self, request, *args, **kwargs):
        """The file itself, in the layout the bank asked for.

        Downloading does **not** mark the batch sent. Generating a file to check
        it is a normal thing to do, and treating that as "the money has gone"
        would make the status a lie the first time someone opens it to look.

        The bank layout is chosen with `?layout=`, never `?format=`: DRF's
        `URL_FORMAT_OVERRIDE` is the string `"format"`, so `?format=nabil` asks
        content negotiation for a renderer by that name and 404s before this
        method runs.

        `send_email` reads its `format` from the request *body*, which the
        override does not touch, so it is left alone.
        """
        batch = self.get_object()
        format_key = request.query_params.get("layout", "generic")
        try:
            content = render_batch(batch, format_key)
        except UnknownBankFormat as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        run = batch.payroll_run
        filename = (
            f"payment-{batch.bank_name.lower().replace(' ', '-')}-"
            f"{run.period_calendar}-{run.period_year}-{run.period_month:02d}.csv"
        )
        response = HttpResponse(content, content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


    @action(detail=True, methods=["post"], url_path="send-email")
    def send_email(self, request, *args, **kwargs):
        """Email the instruction to the bank, with the file attached.

        The batch is marked sent **only if the send succeeded**. That ordering
        is the point: a batch claiming "sent" after a bounce is worse than one
        still in draft, because the first gets acted on and the second gets
        noticed. Unlike notification email — which never raises, so a bounced
        leave notice cannot break an approval — a failed payment instruction
        must stop the state change.
        """
        batch = self.get_object()
        recipients = request.data.get("recipients") or []
        if isinstance(recipients, str):
            recipients = [r.strip() for r in recipients.split(",") if r.strip()]

        try:
            batch = email_batch_to_bank(
                batch,
                recipients,
                format_key=request.data.get("format", "generic"),
                actor=request.user,
                message=request.data.get("message", ""),
            )
        except UnknownBankFormat as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except DisbursementError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        except BankDeliveryError as exc:
            # 502: we failed to hand it over, and the batch is still draft.
            return Response(
                {"detail": str(exc), "code": "bank_delivery_failed"},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response(PaymentBatchSerializer(batch).data)

    @action(detail=True, methods=["post"], url_path="mark-sent")
    def mark_sent(self, request, *args, **kwargs):
        """Record that the instruction has been handed to the bank.

        Deliberately separate from `download`, and deliberately a distinct state
        from acknowledged: sent means we have handed it over, acknowledged means
        they have confirmed. Collapsing the two would let a payslip claim to be
        paid on the strength of an email nobody has answered.
        """
        batch = self.get_object()
        if batch.status != PaymentBatch.Status.DRAFT:
            return Response(
                {"detail": f"This batch is already {batch.get_status_display().lower()}."},
                status=status.HTTP_409_CONFLICT,
            )
        batch.status = PaymentBatch.Status.SENT
        batch.sent_at = timezone.now()
        batch.sent_by = request.user
        batch.updated_by = request.user
        batch.save(update_fields=["status", "sent_at", "sent_by", "updated_by", "updated_at"])
        return Response(PaymentBatchSerializer(batch).data)

    @action(detail=True, methods=["post"])
    def acknowledge(self, request, *args, **kwargs):
        """The bank has confirmed. This is what lets a payslip say "paid".

        Marking the payslips here rather than at `mark-sent` is the point of
        having two states: until the bank confirms, the money has not moved, and
        a payslip saying otherwise is worse than one saying "processing".
        """
        batch = self.get_object()
        if batch.status != PaymentBatch.Status.SENT:
            return Response(
                {"detail": "Only a sent batch can be acknowledged."},
                status=status.HTTP_409_CONFLICT,
            )

        reference = (request.data.get("bank_reference") or "").strip()
        if not reference:
            # Required, because "paid" without a reference cannot be reconciled
            # against a bank statement, which is the entire purpose of recording it.
            return Response(
                {"detail": "A bank reference is required to acknowledge a payment."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        batch.status = PaymentBatch.Status.ACKNOWLEDGED
        batch.acknowledged_at = timezone.now()
        batch.bank_reference = reference
        batch.updated_by = request.user
        batch.save(update_fields=[
            "status", "acknowledged_at", "bank_reference", "updated_by", "updated_at",
        ])

        paid_at = timezone.now()
        updated = Payslip.objects.filter(
            payment_items__batch=batch, status=Payslip.Status.FINALIZED
        ).update(
            status=Payslip.Status.PAID,
            disbursement_method=Payslip.DisbursementMethod.BANK_TRANSFER,
            disbursement_reference=reference,
            paid_at=paid_at,
            updated_by=request.user,
        )
        return Response({**PaymentBatchSerializer(batch).data, "payslips_marked_paid": updated})

    @action(detail=True, methods=["post"], url_path="mark-failed")
    def mark_failed(self, request, *args, **kwargs):
        """The bank rejected it. The payslips stay finalised, not paid.

        A failed batch can be rebuilt after the underlying problem is fixed —
        which is why `build_payment_batches` only refuses to touch *sent* ones.
        """
        batch = self.get_object()
        if batch.status == PaymentBatch.Status.ACKNOWLEDGED:
            return Response(
                {"detail": "This batch was acknowledged — record a reversal instead."},
                status=status.HTTP_409_CONFLICT,
            )
        batch.status = PaymentBatch.Status.FAILED
        batch.failure_reason = (request.data.get("reason") or "").strip()
        batch.updated_by = request.user
        batch.save(update_fields=["status", "failure_reason", "updated_by", "updated_at"])
        return Response(PaymentBatchSerializer(batch).data)


class PayrollReportView(APIView):
    """Company-wide payroll reports that are not scoped to one run.

    Separate from `PayrollRunViewSet` because these answer standing questions —
    what is still owed on advances, what payroll will cost next quarter — rather
    than questions about a particular period.
    """

    permission_classes = [IsAuthenticated, IsHRAdmin]

    def get(self, request, *args, **kwargs):
        kind = request.query_params.get("kind", "advances")
        if kind == "advances":
            return Response(advances_report())
        if kind == "forecast":
            try:
                months = max(1, min(12, int(request.query_params.get("months", 3))))
            except (TypeError, ValueError):
                months = 3
            return Response(forecast(months=months))
        if kind == "statutory-formats":
            # Empty today, and the response says why rather than looking broken.
            return Response({
                "formats": StatutoryReportFormat.available(),
                "note": (
                    "No statutory filing formats are registered yet. eTDS/IRD and PF "
                    "need their published column specifications, and the CIT optimiser "
                    "needs the relief rule (the least of three quantities, not the flat "
                    "ceiling currently stored). A filing that is the right shape and the "
                    "wrong figures gets submitted, which is worse than none."
                ),
            })
        return Response(
            {"detail": "Unknown report. Use kind=advances, forecast or statutory-formats."},
            status=status.HTTP_400_BAD_REQUEST,
        )
