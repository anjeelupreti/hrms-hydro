from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import serializers

from accounts.policy import Perm, can
from accounts.provisioning import AccountError, provision_account
from employees.models import (
    Department,
    Dependant,
    Designation,
    EducationRecord,
    EmergencyContact,
    Employee,
    EmployeeChangeRequest,
    EmployeeLog,
    LifecycleApprovalAction,
    LifecycleEvent,
    Nominee,
)

User = get_user_model()


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ["id", "name", "code", "description", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class DesignationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Designation
        fields = ["id", "title", "department", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class EmployeeListSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    user_id = serializers.IntegerField(read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    designation_title = serializers.CharField(source="designation.title", read_only=True, default=None)
    primary_company_name = serializers.CharField(
        source="primary_company.name", read_only=True, default=None
    )
    # Carried for the card layout, which has room for more than a table row
    # does and was showing less. All three come off rows already joined, so
    # they cost nothing extra per employee.
    manager_name = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = [
            "id",
            "user_id",
            "employee_code",
            "full_name",
            "email",
            "phone",
            "photo",
            "department_name",
            "designation_title",
            "primary_company",
            "primary_company_name",
            "employment_status",
            "date_joined",
            "manager",
            "manager_name",
        ]

    def get_full_name(self, obj):
        return obj.user.get_full_name() or obj.user.get_username()

    def get_manager_name(self, obj):
        manager = obj.manager
        if manager is None or manager.user_id is None:
            return None
        return manager.user.get_full_name() or manager.user.get_username()


class EmployeeLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeLog
        fields = ["id", "field", "from_value", "to_value", "actor_name", "created_at"]

    def get_actor_name(self, obj):
        if obj.actor is None:
            return None
        return obj.actor.get_full_name() or obj.actor.get_username()


class EmployeeDetailSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    first_name = serializers.CharField(source="user.first_name", read_only=True)
    last_name = serializers.CharField(source="user.last_name", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    primary_company_name = serializers.CharField(
        source="primary_company.name", read_only=True, default=None
    )
    #: Named, not just id'd. The profile shows "also works for Sanjen
    #: Jalavidyut", and a list of primary keys is not that.
    secondary_company_names = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = [
            "id",
            "employee_code",
            "full_name",
            "first_name",
            "last_name",
            "email",
            "photo",
            "phone",
            "date_of_birth",
            "gender",
            "date_joined",
            "employment_status",
            "probation_end_date",
            "department",
            "designation",
            "manager",
            "primary_company",
            "primary_company_name",
            "secondary_companies",
            "secondary_company_names",
            # ── Sensitive: stripped for anyone who is not HR or the owner.
            # See `SENSITIVE_FIELDS` and `to_representation` below.
            "bank_name",
            "bank_branch",
            "bank_account_name",
            "bank_account_number",
            "bank_account_type",
            "legal_first_name",
            "legal_middle_name",
            "legal_last_name",
            "citizenship_number",
            "citizenship_front",
            "citizenship_back",
            "marital_status",
            "pan_number",
            "ssf_number",
            "pf_number",
            "cit_number",
            "passport_number",
            "passport_expiry",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "employee_code", "created_at", "updated_at"]

    #: Fields nobody but HR and the employee themselves may read.
    #:
    #: The directory list uses this same serializer, so adding a PAN or a
    #: citizenship scan to `fields` without gating them would publish every
    #: employee's identity documents to every colleague — the exact leak the
    #: document-visibility work exists to prevent, arriving through a different
    #: door. Stripped in `to_representation` rather than by swapping serializers,
    #: so a new caller cannot get the ungated version by accident.
    SENSITIVE_FIELDS = (
        "bank_name", "bank_branch", "bank_account_name", "bank_account_number",
        "bank_account_type", "legal_first_name", "legal_middle_name",
        "legal_last_name", "citizenship_number", "citizenship_front",
        "citizenship_back", "marital_status", "pan_number", "ssf_number",
        "pf_number", "cit_number", "passport_number", "passport_expiry",
    )

    def get_full_name(self, obj):
        return obj.user.get_full_name() or obj.user.get_username()

    def get_secondary_company_names(self, obj):
        return [company.name for company in obj.secondary_companies.all()]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        user = getattr(request, "user", None)

        if user is None:
            # No request context — a management command, a serializer used in a
            # task. Fail closed: strip rather than assume the caller is trusted.
            for field in self.SENSITIVE_FIELDS:
                data.pop(field, None)
            return data

        # The capability check belongs here as much as in a viewset: these
        # statutory fields are gated on serialisation, which no permission
        # class on the view can reach.
        is_hr = can(user, Perm.PEOPLE_MANAGE)
        own = getattr(user, "employee", None)
        is_owner = own is not None and own.pk == instance.pk

        if not (is_hr or is_owner):
            for field in self.SENSITIVE_FIELDS:
                data.pop(field, None)
            return data

        # Masked even for those allowed to see it. A full account number is
        # needed to *build a payment file*, which is a server-side job — nobody
        # needs it rendered in a browser, and a shoulder-surfed screenshot is a
        # real way these leak.
        account = data.get("bank_account_number")
        if account:
            data["bank_account_number"] = f"****{account[-4:]}"
        return data


def _next_employee_code():
    last = Employee.objects.order_by("-id").values_list("employee_code", flat=True).first()
    next_number = 1
    if last and last.startswith("EMP-"):
        try:
            next_number = int(last.split("-")[1]) + 1
        except (IndexError, ValueError):
            pass
    return f"EMP-{next_number:04d}"


class EmployeeWriteSerializer(serializers.ModelSerializer):
    """Create/update. Creation also provisions the linked `User` and mails the
    temporary credentials, via `accounts.provisioning` — the same path the
    hiring route uses, so the two cannot disagree about whether a new employee
    can actually sign in."""

    first_name = serializers.CharField(write_only=True, required=False, default="")
    last_name = serializers.CharField(write_only=True, required=False, default="")
    email = serializers.EmailField(write_only=True, required=False)

    class Meta:
        model = Employee
        # Every field the employee form can set, including the photo, the
        # identity documents and the statutory numbers. A key this list does not
        # declare is dropped from a `PATCH` and answered `200 OK`, so anything
        # the form offers has to appear here or it saves silently to nothing.
        #
        # Reading is gated in `EmployeeDetailSerializer.to_representation` and
        # writing is gated at the viewset by `PEOPLE_MANAGE`; this list governs
        # neither, only what is accepted at all.
        fields = [
            "id",
            "first_name",
            "last_name",
            "email",
            "photo",
            "phone",
            "date_of_birth",
            "gender",
            "marital_status",
            "date_joined",
            "employment_status",
            "probation_end_date",
            "department",
            "designation",
            "manager",
            "primary_company",
            "secondary_companies",
            # The name on the citizenship certificate, which is the one payroll
            # and the statutory filings have to agree with.
            "legal_first_name",
            "legal_middle_name",
            "legal_last_name",
            "citizenship_number",
            "citizenship_front",
            "citizenship_back",
            "passport_number",
            "passport_expiry",
            # What payroll files against.
            "pan_number",
            "ssf_number",
            "pf_number",
            "cit_number",
            "bank_name",
            "bank_branch",
            "bank_account_name",
            "bank_account_number",
            "bank_account_type",
        ]

    #: Dates a person's record is allowed not to have.
    #:
    #: All three are `null=True` on the model. A form posts every field it
    #: holds, so an untouched date arrives as `""`, which DRF's `DateField`
    #: rejects outright — `to_internal_value` below normalises it to `None`
    #: first. Done here rather than in the form because the importer and any
    #: integration post the same empty string for the same reason.
    BLANKABLE_DATES = ("date_of_birth", "probation_end_date", "passport_expiry")

    def to_internal_value(self, data):
        if any(data.get(field) == "" for field in self.BLANKABLE_DATES):
            data = data.copy()
            for field in self.BLANKABLE_DATES:
                if data.get(field) == "":
                    data[field] = None
        return super().to_internal_value(data)

    def validate(self, attrs):
        if self.instance is None and not attrs.get("email"):
            raise serializers.ValidationError({"email": "Required when creating an employee."})

        # A secondary company is somewhere they *also* work, so naming the
        # primary there is either a mistake or a claim that means nothing.
        primary = attrs.get("primary_company", getattr(self.instance, "primary_company", None))
        if "secondary_companies" in attrs:
            secondary = attrs["secondary_companies"]
        elif self.instance is not None:
            # Absent from a PATCH that does not mention it — read through to
            # what is stored rather than treating a missing key as "none".
            secondary = list(self.instance.secondary_companies.all())
        else:
            secondary = []
        if primary is not None and primary in secondary:
            raise serializers.ValidationError({
                "secondary_companies": (
                    f"{primary.name} is already this employee's primary company. "
                    "List only the others they also work for."
                )
            })
        return attrs

    def validate_bank_account_number(self, value):
        """Refuse the mask that reading the record hands back.

        `EmployeeDetailSerializer` deliberately returns `****1234` rather than
        the full account number. A form that loads a record and saves it whole
        therefore posts the mask straight back — and without this, that would
        overwrite the real account number with four asterisks and four digits,
        destroying the only copy and breaking the next payment file. The mask is
        never something somebody typed, so rejecting it costs nobody anything.
        """
        if value and set(value.rstrip("0123456789")) == {"*"}:
            raise serializers.ValidationError(
                "That is the masked account number, not the real one. Leave it "
                "untouched to keep the number on file, or type the full number."
            )
        return value

    @transaction.atomic
    def create(self, validated_data):
        email = validated_data.pop("email")
        first_name = validated_data.pop("first_name", "")
        last_name = validated_data.pop("last_name", "")

        # One provisioning path, shared with the hiring route — see
        # accounts/provisioning.py for why these stopped being two.
        try:
            user = provision_account(email=email, first_name=first_name, last_name=last_name)
        except AccountError as exc:
            raise serializers.ValidationError({"email": str(exc)}) from exc

        return Employee.objects.create(
            user=user, employee_code=_next_employee_code(), **validated_data
        )

    TRACKED_FIELDS = ["employment_status", "department", "designation", "manager", "probation_end_date"]

    @transaction.atomic
    def update(self, instance, validated_data):
        validated_data.pop("email", None)
        first_name = validated_data.pop("first_name", None)
        last_name = validated_data.pop("last_name", None)
        if first_name is not None or last_name is not None:
            if first_name is not None:
                instance.user.first_name = first_name
            if last_name is not None:
                instance.user.last_name = last_name
            instance.user.save(update_fields=["first_name", "last_name"])

        before = {field: getattr(instance, field) for field in self.TRACKED_FIELDS}
        instance = super().update(instance, validated_data)
        self._log_changes(instance, before)
        return instance

    def _log_changes(self, instance, before):
        request = self.context.get("request")
        actor = getattr(request, "user", None) if request else None
        entries = []
        for field in self.TRACKED_FIELDS:
            old, new = before[field], getattr(instance, field)
            if old != new:
                entries.append(
                    EmployeeLog(
                        employee=instance,
                        field=field,
                        from_value=str(old) if old is not None else "",
                        to_value=str(new) if new is not None else "",
                        actor=actor,
                    )
                )
        if entries:
            EmployeeLog.objects.bulk_create(entries)


class LifecycleApprovalActionSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = LifecycleApprovalAction
        fields = ["id", "decision", "comment", "actor_name", "created_at"]

    def get_actor_name(self, obj):
        if obj.actor is None:
            return None
        return obj.actor.get_full_name() or obj.actor.get_username()


class LifecycleEventSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    employee_name = serializers.SerializerMethodField()
    new_designation_title = serializers.CharField(source="new_designation.title", read_only=True, default=None)
    new_department_name = serializers.CharField(source="new_department.name", read_only=True, default=None)
    new_manager_name = serializers.SerializerMethodField()

    class Meta:
        model = LifecycleEvent
        fields = [
            "id",
            "employee",
            "employee_code",
            "employee_name",
            "event_type",
            "status",
            "effective_date",
            "reason",
            "new_designation",
            "new_designation_title",
            "new_department",
            "new_department_name",
            "new_manager",
            "new_manager_name",
            "award_title",
            "last_working_date",
            "applied_at",
            "created_at",
        ]
        read_only_fields = ["status", "applied_at", "created_at"]

    def get_employee_name(self, obj):
        return obj.employee.user.get_full_name() or obj.employee.user.get_username()

    def get_new_manager_name(self, obj):
        if obj.new_manager is None:
            return None
        return obj.new_manager.user.get_full_name() or obj.new_manager.user.get_username()


class LifecycleEventCreateSerializer(serializers.Serializer):
    event_type = serializers.ChoiceField(choices=LifecycleEvent.EventType.choices)
    effective_date = serializers.DateField()
    reason = serializers.CharField(required=False, allow_blank=True, default="")
    new_designation = serializers.PrimaryKeyRelatedField(queryset=Designation.objects.all(), required=False)
    new_department = serializers.PrimaryKeyRelatedField(queryset=Department.objects.all(), required=False)
    new_manager = serializers.PrimaryKeyRelatedField(queryset=Employee.objects.all(), required=False)
    award_title = serializers.CharField(required=False, allow_blank=True, default="")
    last_working_date = serializers.DateField(required=False, allow_null=True, default=None)

    def validate(self, attrs):
        event_type = attrs["event_type"]
        if event_type == LifecycleEvent.EventType.PROMOTION and not attrs.get("new_designation"):
            raise serializers.ValidationError({"new_designation": "Required for a promotion."})
        if event_type == LifecycleEvent.EventType.TRANSFER and not (
            attrs.get("new_department") or attrs.get("new_manager")
        ):
            raise serializers.ValidationError({"new_department": "Provide a new department and/or manager."})
        if event_type == LifecycleEvent.EventType.AWARD and not attrs.get("award_title"):
            raise serializers.ValidationError({"award_title": "Required for an award."})
        if event_type in (LifecycleEvent.EventType.RESIGNATION, LifecycleEvent.EventType.TERMINATION) and not attrs.get(
            "last_working_date"
        ):
            raise serializers.ValidationError({"last_working_date": "Required for a resignation/termination."})
        return attrs


class DecisionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True, default="")


# ── The records a person has, rather than the fields they are ────────────


class EmergencyContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmergencyContact
        fields = [
            "id", "employee", "name", "relationship", "phone",
            "alternate_phone", "address", "is_primary",
        ]
        read_only_fields = ["employee"]


class DependantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Dependant
        fields = [
            "id", "employee", "name", "relationship", "date_of_birth",
            "is_covered_by_insurance", "note",
        ]
        read_only_fields = ["employee"]


class NomineeSerializer(serializers.ModelSerializer):
    scheme_display = serializers.CharField(source="get_scheme_display", read_only=True)

    class Meta:
        model = Nominee
        fields = [
            "id", "employee", "scheme", "scheme_display", "name", "relationship",
            "date_of_birth", "citizenship_number", "share_percent",
        ]
        read_only_fields = ["employee"]

    def validate_share_percent(self, value):
        if value <= 0 or value > 100:
            raise serializers.ValidationError("A share is between 0 and 100 percent.")
        return value

    def validate(self, attrs):
        """Shares within one scheme cannot exceed 100.

        Checked on **over**-allocation only. A list that adds up to 60 is a
        half-finished form, which is a normal thing to save; a list that adds up
        to 130 is a nomination no fund will honour. Refusing the first would
        mean nobody could enter the first of two nominees.
        """
        employee = self.instance.employee if self.instance else self.context.get("employee")
        scheme = attrs.get("scheme") or (self.instance.scheme if self.instance else None)
        share = attrs.get("share_percent")
        if employee is None or scheme is None or share is None:
            return attrs

        others = Nominee.objects.filter(employee=employee, scheme=scheme)
        if self.instance is not None:
            others = others.exclude(pk=self.instance.pk)
        allocated = sum((n.share_percent for n in others), Decimal("0"))

        if allocated + share > Decimal("100"):
            raise serializers.ValidationError(
                {
                    "share_percent": (
                        f"{allocated}% of this scheme is already nominated, so this "
                        f"share cannot exceed {Decimal('100') - allocated}%."
                    )
                }
            )
        return attrs


class EducationRecordSerializer(serializers.ModelSerializer):
    is_verified = serializers.BooleanField(read_only=True)
    verified_by_name = serializers.SerializerMethodField()

    class Meta:
        model = EducationRecord
        fields = [
            "id", "employee", "institution", "qualification", "field_of_study",
            "start_year", "end_year", "grade", "certificate",
            "verified_at", "verified_by", "verified_by_name", "is_verified",
        ]
        # Verification is an act by somebody with a certificate in front of
        # them, never something the person being verified can assert.
        read_only_fields = ["employee", "verified_at", "verified_by"]

    def get_verified_by_name(self, obj):
        if obj.verified_by is None:
            return None
        return obj.verified_by.get_full_name() or obj.verified_by.get_username()

    def validate(self, attrs):
        start = attrs.get("start_year") or getattr(self.instance, "start_year", None)
        end = attrs.get("end_year") or getattr(self.instance, "end_year", None)
        if start and end and end < start:
            raise serializers.ValidationError(
                {"end_year": "A qualification cannot finish before it starts."}
            )
        return attrs


class EmployeeChangeRequestSerializer(serializers.ModelSerializer):
    """Read side. Every write goes through `employees.change_requests`, so the
    rule about who may approve what lives below the API rather than in it."""

    employee_name = serializers.SerializerMethodField()
    field_label = serializers.SerializerMethodField()
    is_sensitive = serializers.SerializerMethodField()
    requested_by_name = serializers.SerializerMethodField()
    decided_by_name = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeChangeRequest
        fields = [
            "id",
            "employee",
            "employee_name",
            "field",
            "field_label",
            "is_sensitive",
            "old_value",
            "new_value",
            "reason",
            "status",
            "requested_by_name",
            "decided_by_name",
            "decided_at",
            "decision_note",
            "created_at",
        ]
        read_only_fields = fields

    def get_employee_name(self, obj):
        return obj.employee.user.get_full_name() or obj.employee.employee_code

    def _field(self, obj):
        from employees.change_requests import FIELDS_BY_NAME

        return FIELDS_BY_NAME.get(obj.field)

    def get_field_label(self, obj):
        field = self._field(obj)
        return field.label if field else obj.field

    def get_is_sensitive(self, obj):
        field = self._field(obj)
        return bool(field and field.sensitive)

    def _name(self, user):
        if user is None:
            return None
        return user.get_full_name() or user.get_username()

    def get_requested_by_name(self, obj):
        return self._name(obj.created_by)

    def get_decided_by_name(self, obj):
        return self._name(obj.decided_by)
