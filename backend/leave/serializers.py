from rest_framework import serializers

from leave.models import ApprovalAction, ApprovalChain, ApprovalStep, LeaveBalance, LeaveRequest, LeaveType


class LeaveTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaveType
        fields = [
            "id",
            "name",
            "code",
            "is_paid",
            "annual_quota_days",
            "carry_forward_allowed",
            "max_carry_forward_days",
            # Retired types stay listed so existing requests still resolve their
            # name; the UI greys them out and stops offering them on new ones.
            "is_active",
        ]


class ApprovalStepSerializer(serializers.ModelSerializer):
    class Meta:
        model = ApprovalStep
        fields = ["id", "chain", "sequence", "approver_role"]


class ApprovalChainSerializer(serializers.ModelSerializer):
    steps = ApprovalStepSerializer(many=True, read_only=True)

    class Meta:
        model = ApprovalChain
        fields = ["id", "name", "is_active", "steps"]


class LeaveBalanceSerializer(serializers.ModelSerializer):
    leave_type_name = serializers.CharField(source="leave_type.name", read_only=True)
    remaining_days = serializers.DecimalField(max_digits=5, decimal_places=1, read_only=True)

    class Meta:
        model = LeaveBalance
        fields = [
            "id",
            "employee",
            "leave_type",
            "leave_type_name",
            "year",
            "allocated_days",
            "carried_forward_days",
            "used_days",
            "remaining_days",
        ]


class ApprovalActionSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalAction
        fields = ["id", "step_sequence", "decision", "comment", "actor_name", "created_at"]

    def get_actor_name(self, obj):
        if obj.actor is None:
            return None
        return obj.actor.get_full_name() or obj.actor.get_username()


class LeaveRequestSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    employee_name = serializers.SerializerMethodField()
    leave_type_name = serializers.CharField(source="leave_type.name", read_only=True)
    #: **Every decision, with who and why.** `ApprovalActionSerializer` existed
    #: and was attached to nothing, so the log the workflow has written all
    #: along could not be read: a request showed a status and no account of how
    #: it got there. It is append-only — see `ApprovalAction` — which is what
    #: makes it worth reading.
    actions = ApprovalActionSerializer(many=True, read_only=True)
    #: Who it is waiting on, resolved the same way the decision endpoint
    #: resolves it, so the answer on screen is the answer the API will enforce.
    awaiting = serializers.SerializerMethodField()
    #: Everybody who was told, whether or not they have to act — the makers as
    #: well as the checker. See `leave.services.effective_chain`.
    supervisors = serializers.SerializerMethodField()
    requested_at = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = LeaveRequest
        fields = [
            "id",
            "employee",
            "employee_code",
            "employee_name",
            "leave_type",
            "leave_type_name",
            "start_date",
            "end_date",
            "half_day",
            "days_requested",
            "reason",
            "status",
            "is_paid",
            "exceeds_balance",
            "current_step",
            "actions",
            "awaiting",
            "supervisors",
            "requested_at",
        ]
        read_only_fields = [
            "id",
            "employee",
            "days_requested",
            "status",
            "is_paid",
            "exceeds_balance",
            "current_step",
        ]

    def get_employee_name(self, obj):
        return obj.employee.user.get_full_name() or obj.employee.user.get_username()

    @staticmethod
    def _label(employee):
        user = employee.user
        name = user.get_full_name() or user.get_username()
        code = employee.employee_code or ""
        return f"{name} ({code})" if code else name

    def get_awaiting(self, obj):
        from leave.services import _current_step

        if obj.status != LeaveRequest.Status.PENDING:
            return None
        step = _current_step(obj)
        if step is None:
            return None
        _sequence, role, person = step
        if person is not None:
            return {"role": role, "name": self._label(person)}
        # `HR_ADMIN` is a capability rather than a named person, and `MANAGER`
        # resolves against the requester — neither has one to give.
        if role == "manager" and obj.employee.manager is not None:
            return {"role": role, "name": self._label(obj.employee.manager)}
        return {"role": role, "name": None}

    def get_supervisors(self, obj):
        from leave.services import _supervisors_of

        people = _supervisors_of(obj.employee)
        return [
            {
                "id": person.pk,
                "name": self._label(person),
                # The last one is the checker whose approval is required; the
                # rest are told for information.
                "decides": index == len(people) - 1,
            }
            for index, person in enumerate(people)
        ]


class LeaveRequestCreateSerializer(serializers.Serializer):
    leave_type = serializers.PrimaryKeyRelatedField(queryset=LeaveType.objects.all())
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    half_day = serializers.BooleanField(default=False)
    reason = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if attrs["end_date"] < attrs["start_date"]:
            raise serializers.ValidationError({"end_date": "Must be on or after the start date."})
        if attrs["half_day"] and attrs["start_date"] != attrs["end_date"]:
            raise serializers.ValidationError({"half_day": "Half-day requests must be a single date."})
        return attrs


class DecisionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True, default="")
