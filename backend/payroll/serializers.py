from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from payroll.models import (
    EmployeeSchemeEnrolment,
    Loan,
    PaymentBatch,
    PaymentBatchItem,
    PaymentExclusion,
    PayrollRun,
    Payslip,
    PayslipLineItem,
    SalaryComponent,
    SalaryStructure,
    SalaryStructureAssignment,
    SalaryTemplate,
    SalaryTemplateLine,
    StatutoryRate,
    TaxSlab,
)


class SalaryComponentSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalaryComponent
        fields = [
            "id",
            "code",
            "name",
            "component_type",
            "calc_type",
            "amount",
            "percentage_of",
            "formula",
            "taxable",
            "is_active",
            "order",
        ]

    def validate(self, attrs):
        calc_type = attrs.get("calc_type", getattr(self.instance, "calc_type", None))
        if calc_type == SalaryComponent.CalcType.PERCENTAGE_OF and not attrs.get(
            "percentage_of", getattr(self.instance, "percentage_of", None)
        ):
            raise serializers.ValidationError({"percentage_of": "Required for PERCENTAGE_OF components."})
        if calc_type == SalaryComponent.CalcType.FORMULA and not attrs.get(
            "formula", getattr(self.instance, "formula", "")
        ):
            raise serializers.ValidationError({"formula": "Required for FORMULA components."})
        return attrs


class TaxSlabSerializer(serializers.ModelSerializer):
    """A band of the income-tax table.

    `taxpayer` and `waived_if_retirement_contributor` were on the model and
    absent from this serializer, so the couple table and the waived band were
    invisible to every screen — the engine could honour them and nobody could
    configure them. Both are exposed now that the engine actually reads them.

    **`min_amount`/`max_amount` are ANNUAL figures, as published.** The engine
    annualises the period's pay before applying them (`payroll/tax.py`), so
    what is stored matches the Finance Act line for line and can be checked
    against it.
    """

    fiscal_year_label = serializers.SerializerMethodField()
    verified_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TaxSlab
        fields = [
            "id", "fiscal_year", "fiscal_year_label", "taxpayer", "order",
            "min_amount", "max_amount", "rate",
            "waived_if_retirement_contributor",
            "is_verified", "verified_by_name", "verified_at", "source",
        ]
        # Verification is its own action, never a writable field — otherwise
        # anybody editing a band could mark their own edit as checked, which
        # empties the flag of meaning.
        read_only_fields = ["is_verified", "verified_by_name", "verified_at"]

    def get_fiscal_year_label(self, obj):
        from core.calendars import company_calendar

        return company_calendar().fiscal_year_label(obj.fiscal_year)

    def get_verified_by_name(self, obj):
        if obj.verified_by is None:
            return None
        return obj.verified_by.get_full_name() or obj.verified_by.get_username()


class StatutoryRateSerializer(serializers.ModelSerializer):
    """One legislated figure for one fiscal year.

    **This table had no API at all.** Eleven rates — SSF and PF both sides,
    gratuity, the relief ceilings and fraction, the insurance ceilings, the
    female rebate, the minimum wage — sat seeded and unreachable, so "every
    statutory figure is configuration" was true of the design and not of the
    product. A rate nobody can edit is a constant with extra steps.
    """

    fiscal_year_label = serializers.SerializerMethodField()
    verified_by_name = serializers.SerializerMethodField()

    class Meta:
        model = StatutoryRate
        fields = [
            "id", "code", "fiscal_year", "fiscal_year_label", "label", "note",
            "value", "unit",
            "is_verified", "verified_by_name", "verified_at", "source",
        ]
        # `code` and `fiscal_year` identify the row — changing either is not an
        # edit, it is a different rate, and silently repointing one would move
        # a figure to a year nobody meant.
        read_only_fields = [
            "code", "fiscal_year", "is_verified", "verified_by_name", "verified_at",
        ]

    def get_fiscal_year_label(self, obj):
        from core.calendars import company_calendar

        return company_calendar().fiscal_year_label(obj.fiscal_year)

    def get_verified_by_name(self, obj):
        if obj.verified_by is None:
            return None
        return obj.verified_by.get_full_name() or obj.verified_by.get_username()


class SalaryStructureAssignmentSerializer(serializers.ModelSerializer):
    component_code = serializers.CharField(source="component.code", read_only=True)
    component_name = serializers.CharField(source="component.name", read_only=True)

    class Meta:
        model = SalaryStructureAssignment
        fields = ["id", "component", "component_code", "component_name", "amount"]


class SalaryStructureSerializer(serializers.ModelSerializer):
    assignments = SalaryStructureAssignmentSerializer(many=True)

    class Meta:
        model = SalaryStructure
        fields = ["id", "employee", "effective_from", "notes", "assignments"]

    @transaction.atomic
    def create(self, validated_data):
        assignments_data = validated_data.pop("assignments")
        structure = SalaryStructure.objects.create(**validated_data)
        SalaryStructureAssignment.objects.bulk_create(
            SalaryStructureAssignment(structure=structure, **assignment) for assignment in assignments_data
        )
        return structure


class SalaryTemplateLineSerializer(serializers.ModelSerializer):
    component_code = serializers.CharField(source="component.code", read_only=True)
    component_name = serializers.CharField(source="component.name", read_only=True)
    component_type = serializers.CharField(source="component.component_type", read_only=True)
    calc_type = serializers.CharField(source="component.calc_type", read_only=True)

    class Meta:
        model = SalaryTemplateLine
        fields = ["id", "component", "component_code", "component_name", "component_type", "calc_type", "amount"]


class SalaryTemplateSerializer(serializers.ModelSerializer):
    lines = SalaryTemplateLineSerializer(many=True)
    #: How many people are currently on a structure stamped from this one.
    #:
    #: Counted rather than stored, and deliberately approximate — a structure
    #: keeps no foreign key back to the template it came from, because the copy
    #: is meant to be independent. This reads the note the copy leaves behind,
    #: which is enough to answer "is this template in use" and is not claimed
    #: to be more than that.
    applied_count = serializers.SerializerMethodField()

    class Meta:
        model = SalaryTemplate
        fields = ["id", "name", "description", "is_default", "lines", "applied_count"]

    def get_applied_count(self, obj):
        return SalaryStructure.objects.filter(notes__contains=f"“{obj.name}”").count()

    def validate_lines(self, value):
        if not value:
            raise serializers.ValidationError(
                "A template needs at least one component, or it would pay nothing."
            )
        return value

    def _write_lines(self, template, lines_data):
        template.lines.all().delete()
        SalaryTemplateLine.objects.bulk_create(
            SalaryTemplateLine(template=template, **line) for line in lines_data
        )

    @transaction.atomic
    def create(self, validated_data):
        lines_data = validated_data.pop("lines")
        template = SalaryTemplate.objects.create(**validated_data)
        self._write_lines(template, lines_data)
        return template

    @transaction.atomic
    def update(self, instance, validated_data):
        # Unlike a structure, a template *is* editable — it is a starting
        # point, not a record of what anybody was paid. Lines are replaced
        # wholesale because a template is small and a partial diff of an
        # unordered set is where the subtle bugs live.
        lines_data = validated_data.pop("lines", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if lines_data is not None:
            self._write_lines(instance, lines_data)
        return instance


class ApplyTemplateSerializer(serializers.Serializer):
    """Who to stamp, and from when."""

    effective_from = serializers.DateField()
    #: Omitted means "everybody active who has no structure at all" — the
    #: setting-up-a-workspace case, and the one that must not need a hundred
    #: checkboxes ticked first.
    employees = serializers.ListField(child=serializers.IntegerField(), required=False)
    replace_existing = serializers.BooleanField(default=False)


class PayslipLineItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayslipLineItem
        fields = ["id", "component_code", "component_name", "component_type", "amount"]


class PayslipLineItemInputSerializer(serializers.Serializer):
    """One HR-edited/added line for a draft payslip. `component_code` is
    optional — a manual adjustment line doesn't map to a configured
    SalaryComponent."""

    component_code = serializers.CharField(max_length=50, required=False, allow_blank=True, default="")
    component_name = serializers.CharField(max_length=100)
    component_type = serializers.ChoiceField(choices=SalaryComponent.ComponentType.choices)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)


class PayslipLineItemsUpdateSerializer(serializers.Serializer):
    line_items = PayslipLineItemInputSerializer(many=True)


class PayslipSerializer(serializers.ModelSerializer):
    # Derived, not stored. Two numbers that must agree are two numbers
    # that can disagree, and this one is a division.
    average_hours = serializers.SerializerMethodField()
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    # The card view shows a face; without this it can only show initials,
    # and a grid of initials is a grid of identical discs.
    employee_photo = serializers.ImageField(source="employee.photo", read_only=True)
    employee_name = serializers.SerializerMethodField()
    period_year = serializers.IntegerField(source="payroll_run.period_year", read_only=True)
    period_month = serializers.IntegerField(source="payroll_run.period_month", read_only=True)
    # A payslip's period is its run's period, named the same way. Without
    # this the payslip list composed a Gregorian month name from the two
    # numbers, so a Bikram Sambat run's payslips were labelled with a month
    # their company does not keep books in (D-06).
    period_calendar = serializers.CharField(source="payroll_run.period_calendar", read_only=True)
    period_label = serializers.CharField(source="payroll_run.period_label", read_only=True)
    line_items = PayslipLineItemSerializer(many=True, read_only=True)

    class Meta:
        model = Payslip
        fields = [
            "id",
            "payroll_run",
            "employee",
            "employee_code",
            "employee_photo",
            "employee_name",
            "period_year",
            "period_month",
            "period_calendar",
            "period_label",
            "gross_earnings",
            "total_deductions",
            "net_pay",
            "period_days",
            "days_attended",
            "hours_worked",
            "average_hours",
            "payable_days",
            # The absence arithmetic, so a payslip can show its working rather
            # than presenting a net figure and asking to be trusted.
            "pay_basis",
            "basis_days",
            "unpaid_days",
            "day_value",
            "absence_deduction",
            "status",
            "is_held",
            "hold_reason",
            "held_by",
            "held_at",
            "released_by",
            "released_at",
            "disbursement_method",
            "disbursement_reference",
            "paid_at",
            "line_items",
        ]
        read_only_fields = [
            "payroll_run",
            "employee",
            "is_held",
            "hold_reason",
            "held_by",
            "held_at",
            "released_by",
            "released_at",
            "gross_earnings",
            "total_deductions",
            "net_pay",
            "period_days",
            "payable_days",
            # The absence arithmetic, so the payslip can show its working
            # rather than presenting a net figure and asking to be trusted.
            "pay_basis",
            "basis_days",
            "unpaid_days",
            "day_value",
            "absence_deduction",
            "status",
            "disbursement_method",
            "disbursement_reference",
            "paid_at",
        ]

    def get_average_hours(self, obj):
        """Across days attended, not across the period.

        Dividing by period days mixes weekends, holidays and a mid-month join
        into one figure that means nothing: somebody who worked eight hours on
        each of the four days they were in did not average one hour a day.
        """
        if not obj.days_attended:
            return "0.00"
        return str((obj.hours_worked / obj.days_attended).quantize(Decimal("0.01")))

    def get_employee_name(self, obj):
        return obj.employee.user.get_full_name() or obj.employee.user.get_username()


class MarkPaidSerializer(serializers.Serializer):
    disbursement_method = serializers.ChoiceField(choices=Payslip.DisbursementMethod.choices)
    disbursement_reference = serializers.CharField(required=False, allow_blank=True, default="")


class PayrollRunSerializer(serializers.ModelSerializer):
    # `payslip_count` was `source="payslips.count"` — a COUNT query per row, so
    # listing twelve runs issued twelve extra queries. It is now the
    # denormalised column, which is the reason that column exists.
    error_count = serializers.SerializerMethodField()
    # The period, said the way the company says it — "Shrawan 2083". Served
    # rather than composed in the browser, because naming a month is a calendar
    # question and the browser does not own a conversion table (D‑06, §2.6).
    period_label = serializers.CharField(read_only=True)
    period_start = serializers.SerializerMethodField()
    period_end = serializers.SerializerMethodField()
    #: Read-only: which entity payroll runs through is a property of the
    #: installation, not something an operator picks per run.
    company_name = serializers.CharField(source="company.name", read_only=True, default=None)

    class Meta:
        model = PayrollRun
        read_only_fields = ["company"]
        fields = [
            "id", "period_calendar", "period_year", "period_month",
            "period_label", "period_start", "period_end",
            "status", "notes",
            "company", "company_name",
            "payslip_count", "total_gross", "total_deductions", "total_net",
            "locked_at", "error_count",
        ]
        read_only_fields = [
            "status", "payslip_count", "total_gross", "total_deductions",
            "total_net", "locked_at",
        ]

    def _window(self, obj):
        from payroll.periods import period_window

        return period_window(obj)

    def get_period_start(self, obj):
        """The Gregorian days this run actually covers.

        Exposed because "Shrawan 2083" tells a reader nothing about which days
        were paid, and the whole defect was a label that agreed with the law
        while the window underneath did not.
        """
        return self._window(obj)[0].isoformat()

    def get_period_end(self, obj):
        return self._window(obj)[1].isoformat()

    def get_error_count(self, obj):
        """Unresolved only — a resolved error is history, not a blocker.

        Annotated by the viewset where possible; the fallback keeps a single
        serialised run correct outside that queryset.
        """
        annotated = getattr(obj, "unresolved_error_count", None)
        if annotated is not None:
            return annotated
        return obj.errors.filter(resolved_at__isnull=True).count()


class LoanSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    employee_name = serializers.SerializerMethodField()

    class Meta:
        model = Loan
        fields = [
            "id",
            "employee",
            "employee_code",
            "employee_name",
            "loan_type",
            "principal_amount",
            "monthly_deduction",
            "outstanding_balance",
            "reason",
            "status",
            "start_date",
            "closed_at",
        ]
        read_only_fields = ["employee", "outstanding_balance", "status", "start_date", "closed_at"]

    def get_employee_name(self, obj):
        return obj.employee.user.get_full_name() or obj.employee.user.get_username()


class LoanCreateSerializer(serializers.Serializer):
    loan_type = serializers.ChoiceField(choices=Loan.LoanType.choices)
    principal_amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    monthly_deduction = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    reason = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if attrs["monthly_deduction"] > attrs["principal_amount"]:
            raise serializers.ValidationError(
                {"monthly_deduction": "Can't exceed the principal amount."}
            )
        return attrs


class LoanDecisionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True, default="")


class PaymentBatchItemSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source="payslip.employee.employee_code", read_only=True)

    class Meta:
        model = PaymentBatchItem
        fields = [
            "id", "employee_code", "account_name", "account_number",
            "account_type", "branch", "amount",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Masked here as it is everywhere else. The full number lives in the
        # rendered file, which is downloaded deliberately and not rendered in a
        # list — see EmployeeSerializer for the same reasoning.
        if data.get("account_number"):
            data["account_number"] = f"****{data['account_number'][-4:]}"
        return data


class PaymentBatchSerializer(serializers.ModelSerializer):
    items = PaymentBatchItemSerializer(many=True, read_only=True)

    class Meta:
        model = PaymentBatch
        fields = [
            "id", "payroll_run", "bank_name", "status", "total_amount",
            "payslip_count", "sent_at", "acknowledged_at", "bank_reference",
            "failure_reason", "items",
        ]
        read_only_fields = fields


class PaymentExclusionSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source="payslip.employee.employee_code", read_only=True)
    employee_name = serializers.SerializerMethodField()

    class Meta:
        model = PaymentExclusion
        fields = ["id", "payslip", "employee_code", "employee_name", "reason", "created_at"]
        read_only_fields = fields

    def get_employee_name(self, obj):
        user = obj.payslip.employee.user
        return user.get_full_name() or user.get_username()


class EmployeeSchemeEnrolmentSerializer(serializers.ModelSerializer):
    """One person's membership of one scheme.

    **A row exists only where somebody differs from the company.** Absence means
    "follow the company", so switching a scheme on is not a data-entry project
    whose half-done state silently under-deducts. What a row says is: this
    person is out, or pays a different rate, or has chosen a CIT amount.
    """

    employee_name = serializers.SerializerMethodField()
    scheme_label = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeSchemeEnrolment
        fields = [
            "id", "employee", "employee_name", "scheme", "scheme_label",
            "is_active", "employee_rate", "monthly_amount", "reference",
        ]

    def get_employee_name(self, obj):
        return obj.employee.user.get_full_name() or obj.employee.employee_code

    def get_scheme_label(self, obj):
        from payroll.schemes import SCHEME_LABELS

        return SCHEME_LABELS.get(obj.scheme, obj.scheme)

    def validate_scheme(self, value):
        """Only schemes the engine knows. A typo here would create a row that
        silently does nothing, which reads as "enrolled" on screen."""
        from payroll.schemes import Scheme

        valid = {code for code, _ in Scheme.CHOICES}
        if value not in valid:
            raise serializers.ValidationError(
                f"Unknown scheme. Use one of: {', '.join(sorted(valid))}."
            )
        return value

    def validate(self, attrs):
        """CIT needs an amount; SSF and PF must not carry one.

        CIT is the only voluntary scheme, so it is the only one where a rupee
        figure means anything. An amount on an SSF row would be silently
        ignored — a setting that looks like it does something and does not is
        worse than no setting.
        """
        from payroll.schemes import Scheme

        scheme = attrs.get("scheme", getattr(self.instance, "scheme", None))
        amount = attrs.get("monthly_amount", getattr(self.instance, "monthly_amount", None))
        rate = attrs.get("employee_rate", getattr(self.instance, "employee_rate", None))

        if scheme == Scheme.CIT:
            if rate is not None:
                raise serializers.ValidationError(
                    {"employee_rate": "CIT is a chosen amount, not a percentage."}
                )
            if amount is None:
                raise serializers.ValidationError(
                    {"monthly_amount": "Say how much to deduct each month."}
                )
        elif amount is not None:
            raise serializers.ValidationError(
                {"monthly_amount": f"{scheme.upper()} is a percentage of basic, not an amount."}
            )
        return attrs
