from rest_framework import serializers

from organization.models import CompanyProfile, Review, ReviewCycle, CompanyEmailSettings


class CompanyProfileSerializer(serializers.ModelSerializer):
    #: The months of *this company's* calendar, in order, so the settings screen
    #: can offer "Shrawan" to a Nepali company and "April" to an Indian one
    #: without shipping a second copy of either month list to the browser.
    calendar_months = serializers.SerializerMethodField()
    #: Where the financial year actually starts once the default is applied —
    #: served rather than derived, because a client working it out from
    #: `calendar` + a null override is a second implementation of a rule that
    #: already has one (§2.6).
    fiscal_year_start_month_effective = serializers.SerializerMethodField()
    fiscal_year_label = serializers.SerializerMethodField()

    class Meta:
        model = CompanyProfile
        fields = [
            "id",
            "name",
            "logo",
            "address",
            "timezone",
            # Which calendar the fiscal year, payslips and leave entitlements
            # follow. Editable here because it is a setup decision, not a
            # constant — see core.calendars.company_calendar.
            "calendar",
            # Empty means "this calendar's own year". Set only by a company
            # whose country runs a year the calendar does not imply.
            "fiscal_year_start_month",
            "fiscal_year_start_month_effective",
            # Which retirement fund this company runs, and what else it offers.
            # One field rather than two booleans, so "SSF and PF together" —
            # which double-deducts — is a state that cannot be represented.
            "retirement_scheme",
            # Pausing is not the same as having no scheme — see the model.
            "retirement_paused",
            "offers_cit",
            "provides_gratuity",
            "calendar_months",
            "fiscal_year_label",
            "working_days",
            # The office span. The attendance clock measures hours worked
            # against these, so they have to reach the client.
            "office_start_time",
            "office_end_time",
            "pay_basis",
            "payroll_prorate",
            "overtime_multiplier",
        ]

    def _calendar(self, obj):
        from core.calendars import get_calendar

        return get_calendar(obj.calendar)

    def get_calendar_months(self, obj):
        months = self._calendar(obj).month_names
        return [{"value": i, "label": name} for i, name in enumerate(months, start=1)]

    def get_fiscal_year_start_month_effective(self, obj):
        base = self._calendar(obj)
        return obj.fiscal_year_start_month or base.fiscal_start_month

    def get_fiscal_year_label(self, obj):
        """What the current financial year is called, under these settings.

        The point of showing it is that the setting is otherwise abstract: a
        month number does not tell somebody whether they just moved their
        company into 2082/83 or 2083/84.
        """
        from datetime import date

        calendar = self._calendar(obj).with_fiscal_start(obj.fiscal_year_start_month)
        try:
            return calendar.fiscal_year_label(calendar.fiscal_year_of(date.today()))
        except Exception:  # noqa: BLE001 — an unconvertible today is not a settings error
            return None

    def validate_retirement_scheme(self, value):
        """🔒 Refused while a component already deducts the same thing.

        Switching a company onto SSF while their hand-built "Provident Fund"
        component is still active deducts the obligation **twice** — both off
        the same basic, and the payslip looks entirely ordinary. Caught here so
        it is a settings error somebody can act on, rather than a payroll error
        discovered on run day.

        The overlap is read from the component's own `scheme` tag, not from its
        name: acting on a name would silently stop deducting somebody's "PF
        Loan Repayment", which is the opposite failure.
        """
        if not value or (self.instance and value == self.instance.retirement_scheme):
            return value

        from payroll.schemes import describe_overlap

        clash = describe_overlap(value)
        if clash:
            raise serializers.ValidationError(clash)
        return value

    def validate_fiscal_year_start_month(self, value):
        """Refused once payroll has run — the D‑06 lesson, applied.

        Moving the year boundary re-keys which fiscal year a date belongs to,
        and `LeaveBalance`, `TaxSlab` and `StatutoryRate` are all keyed on it.
        Doing that under runs that have already been computed and paid would
        make finalised payslips refer to a year that no longer means what it
        meant when they were produced — the same class of defect as relabelling
        a Gregorian run "Shrawan 2083", which D‑06 refused for the same reason.

        Deliberately checked against *any* run rather than only finalised ones:
        a draft is already computed over a period, and silently moving the
        period under it is how a draft stops matching its own inputs.
        """
        if self.instance is None or value == self.instance.fiscal_year_start_month:
            return value

        from payroll.models import PayrollRun

        if PayrollRun.objects.exists():
            raise serializers.ValidationError(
                "Payroll has already been run on the current financial year, so its "
                "start month can no longer be moved — the fiscal year is what leave "
                "balances and tax slabs are keyed on. Set this up before the first run."
            )
        return value


class CompanyEmailSettingsSerializer(serializers.ModelSerializer):
    """`password` is write-only and never round-tripped back — reads only
    expose whether one is set, via `password_is_set`."""

    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    password_is_set = serializers.SerializerMethodField()

    class Meta:
        model = CompanyEmailSettings
        fields = [
            "id",
            "host",
            "port",
            "username",
            "password",
            "password_is_set",
            "from_email",
            "use_tls",
            "is_active",
            "imap_host",
            "imap_port",
            "imap_use_ssl",
        ]

    def get_password_is_set(self, obj):
        return bool(obj.encrypted_password)

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        instance = super().update(instance, validated_data)
        if password:
            instance.set_password(password)
            instance.save(update_fields=["encrypted_password", "updated_at"])
        return instance


class EmailConnectionTestSerializer(serializers.Serializer):
    host = serializers.CharField()
    port = serializers.IntegerField()
    username = serializers.CharField(allow_blank=True, default="")
    password = serializers.CharField(allow_blank=True, default="")
    use_tls = serializers.BooleanField(default=True)


class ImapConnectionTestSerializer(serializers.Serializer):
    """Tests candidate IMAP settings before saving. `password` may be blank
    to mean 'use the already-saved one' — the view resolves that."""

    imap_host = serializers.CharField()
    imap_port = serializers.IntegerField(default=993)
    username = serializers.CharField(allow_blank=True, default="")
    password = serializers.CharField(allow_blank=True, default="", required=False)
    imap_use_ssl = serializers.BooleanField(default=True)


class ReviewCycleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReviewCycle
        fields = ["id", "name", "start_date", "end_date", "status"]
        read_only_fields = ["status"]


class ReviewSerializer(serializers.ModelSerializer):
    cycle_name = serializers.CharField(source="cycle.name", read_only=True)
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    employee_name = serializers.SerializerMethodField()
    reviewer_name = serializers.SerializerMethodField()

    class Meta:
        model = Review
        fields = [
            "id",
            "cycle",
            "cycle_name",
            "employee",
            "employee_code",
            "employee_name",
            "reviewer",
            "reviewer_name",
            "status",
            "self_assessment",
            "self_rating",
            "self_submitted_at",
            "manager_assessment",
            "manager_rating",
            "manager_submitted_at",
        ]
        read_only_fields = fields

    def get_employee_name(self, obj):
        return obj.employee.user.get_full_name() or obj.employee.user.get_username()

    def get_reviewer_name(self, obj):
        if obj.reviewer is None:
            return None
        return obj.reviewer.user.get_full_name() or obj.reviewer.user.get_username()


class SelfAssessmentSerializer(serializers.Serializer):
    self_assessment = serializers.CharField()
    self_rating = serializers.IntegerField(min_value=1, max_value=5)


class ManagerAssessmentSerializer(serializers.Serializer):
    manager_assessment = serializers.CharField()
    manager_rating = serializers.IntegerField(min_value=1, max_value=5)
