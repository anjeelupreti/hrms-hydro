from rest_framework import serializers

from expenses.models import ExpenseBudget, ExpenseClaim


class ExpenseClaimSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    department_name = serializers.CharField(source="employee.department.name", read_only=True, default=None)
    decided_by_name = serializers.SerializerMethodField()
    receipt_url = serializers.SerializerMethodField()

    class Meta:
        model = ExpenseClaim
        fields = [
            "id",
            "employee",
            "employee_name",
            "employee_code",
            "department_name",
            "title",
            "category",
            "amount",
            "expense_date",
            "description",
            "receipt",
            "receipt_url",
            "status",
            "decided_by_name",
            "decided_at",
            "decision_note",
            "reimbursed_at",
            "reimbursement_reference",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "employee",
            "status",
            "decided_by_name",
            "decided_at",
            "decision_note",
            "reimbursed_at",
            "reimbursement_reference",
            "created_at",
        ]
        extra_kwargs = {"receipt": {"write_only": True, "required": False}}

    def get_employee_name(self, obj):
        return obj.employee.user.get_full_name() or obj.employee.user.get_username()

    def get_decided_by_name(self, obj):
        return obj.decided_by.get_full_name() or obj.decided_by.get_username() if obj.decided_by else None

    def get_receipt_url(self, obj):
        return bool(obj.receipt)


class ExpenseDecisionSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, default="")


class ReimburseSerializer(serializers.Serializer):
    reference = serializers.CharField(required=False, allow_blank=True, default="")


class ExpenseBudgetSerializer(serializers.ModelSerializer):
    """A budget, plus how much of it is gone.

    `spent` and `remaining` are computed on read rather than stored. A stored
    running total is a number that goes wrong the first time a claim is
    cancelled and stays wrong until somebody notices.
    """

    department_name = serializers.CharField(
        source="department.name", read_only=True, default=None
    )
    employee_name = serializers.SerializerMethodField()
    category_display = serializers.SerializerMethodField()
    period_display = serializers.CharField(source="get_period_display", read_only=True)
    scope_label = serializers.SerializerMethodField()
    #: Rendered the way `amount` is — a quantised string.
    #:
    #: A `SerializerMethodField` returning a raw `Decimal` comes out of the
    #: JSON renderer as a float, so the same payload would carry `amount` as
    #: "10000.00" and `spent` as 2500.0, and the browser would have to know
    #: which fields are which before it could subtract them.
    spent = serializers.SerializerMethodField()
    remaining = serializers.SerializerMethodField()
    used_percent = serializers.SerializerMethodField()

    class Meta:
        model = ExpenseBudget
        fields = [
            "id", "name", "category", "category_display",
            "department", "department_name", "employee", "employee_name",
            "period", "period_display", "amount", "per_claim_cap",
            "warn_at_percent", "enforcement", "is_active", "note",
            "scope_label", "spent", "remaining", "used_percent",
            "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def get_employee_name(self, obj):
        if obj.employee is None:
            return None
        user = obj.employee.user
        return user.get_full_name() or user.get_username()

    def get_category_display(self, obj):
        return obj.get_category_display() if obj.category else "All categories"

    def get_scope_label(self, obj):
        return obj.label()

    def _spent(self, obj):
        from datetime import date

        from expenses.budgets import spent_against

        # Cached on the instance: three of the four fields below need the same
        # aggregate, and a list of twenty budgets would otherwise run sixty
        # queries to render one page.
        if not hasattr(obj, "_spent_cache"):
            obj._spent_cache = spent_against(obj, date.today())
        return obj._spent_cache

    @staticmethod
    def _money(value):
        return f"{value:.2f}"

    def get_spent(self, obj):
        return self._money(self._spent(obj))

    def get_remaining(self, obj):
        if not obj.amount:
            return None
        return self._money(obj.amount - self._spent(obj))

    def get_used_percent(self, obj):
        if not obj.amount:
            return None
        return round(float(self._spent(obj)) / float(obj.amount) * 100, 1)
