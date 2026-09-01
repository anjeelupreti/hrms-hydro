from rest_framework import serializers

from expenses.models import ExpenseClaim


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
