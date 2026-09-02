from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import serializers

from accounts.policy import Perm, can
from accounts.provisioning import AccountError, provision_account
from employees.models import (
    Award,
    CorporatePost,
    CorporateRole,
    DisciplinaryAction,
    Suspension,
    Department,
    Dependant,
    Designation,
    EducationRecord,
    EmergencyContact,
    Employee,
    EmployeeChangeRequest,
    EmployeeExperience,
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
    # The chair and the work — see `Employee.corporate_post` for why they are
    # two fields. Both on the list because the roster is the screen people scan
    # to find "who is the Deputy Manager running Sanjen".
    corporate_post_name = serializers.CharField(
        source="corporate_post.name", read_only=True, default=None
    )
    corporate_role_name = serializers.CharField(
        source="corporate_role.name", read_only=True, default=None
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
            "corporate_post_name",
            "corporate_role_name",
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
    corporate_post_name = serializers.CharField(
        source="corporate_post.name", read_only=True, default=None
    )
    corporate_role_name = serializers.CharField(
        source="corporate_role.name", read_only=True, default=None
    )
    #: The suspension in force right now, if there is one. Inlined rather than
    #: left to a second request, because every surface that shows the status
    #: also has to show why and until when — a bare "Suspended" chip with no
    #: date is the thing people ask HR about.
    active_suspension = serializers.SerializerMethodField()

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
            "corporate_post",
            "corporate_post_name",
            "corporate_role",
            "corporate_role_name",
            "blood_group",
            "permanent_address",
            "temporary_address",
            "office_phone",
            "office_email",
            "personal_phone",
            "personal_email",
            "active_suspension",
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
        # Where somebody lives and how to reach them off duty.
        #
        # These arrived with the corporate-contact work and were not added
        # here, so every colleague could read every home address and personal
        # mobile number off the directory. The distinction is the one the
        # fields themselves draw: `office_phone` and `office_email` are
        # *correspondence* details and stay visible — that is what a directory
        # is for — while the personal pair and the two addresses are not the
        # company's to publish internally.
        #
        # `blood_group` is deliberately *not* here: it is on the ID card for
        # the same reason it is in this system, and the one moment it matters
        # is the one moment nobody can ask HR.
        "personal_phone", "personal_email",
        "permanent_address", "temporary_address",
    )

    def get_full_name(self, obj):
        return obj.user.get_full_name() or obj.user.get_username()

    def get_secondary_company_names(self, obj):
        return [company.name for company in obj.secondary_companies.all()]

    def get_active_suspension(self, obj):
        from employees.suspensions import active_suspension

        suspension = active_suspension(obj)
        if suspension is None:
            return None
        return {
            "id": suspension.id,
            "starts_on": suspension.starts_on,
            "ends_on": suspension.ends_on,
            "reason": suspension.reason,
        }

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
            "corporate_post",
            "corporate_role",
            "blood_group",
            "permanent_address",
            "temporary_address",
            "office_phone",
            "office_email",
            "personal_phone",
            "personal_email",
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


# ── The lookups behind post and role ─────────────────────────────────────


class EmployeeExperienceAdminSerializer(serializers.ModelSerializer):
    """Work history, as HR maintains it.

    Distinct from `accounts.EmployeeExperienceSerializer`, which is the one an
    employee uses on their own profile and which cannot set `is_verified` —
    a claim that verifies itself is not a check. This one can, because
    confirming an entry against a document is the whole reason the flag exists.
    """

    employee_name = serializers.SerializerMethodField()
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)

    class Meta:
        model = EmployeeExperience
        fields = [
            "id", "employee", "employee_name", "kind", "kind_display",
            "title", "company", "start_year", "end_year", "description",
            "is_verified",
        ]

    def get_employee_name(self, obj):
        return obj.employee.user.get_full_name() or obj.employee.employee_code

    def validate(self, attrs):
        start = attrs.get("start_year", getattr(self.instance, "start_year", None))
        end = attrs.get("end_year", getattr(self.instance, "end_year", None))
        if start and end and end < start:
            raise serializers.ValidationError(
                {"end_year": "A post cannot end before it started."}
            )
        return attrs


class CorporatePostSerializer(serializers.ModelSerializer):
    employee_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = CorporatePost
        fields = ["id", "name", "code", "rank", "description", "is_active", "employee_count"]


class CorporateRoleSerializer(serializers.ModelSerializer):
    company_name = serializers.CharField(source="company.name", read_only=True, default=None)
    employee_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = CorporateRole
        fields = [
            "id", "name", "code", "description", "company", "company_name",
            "is_active", "employee_count",
        ]


# ── Suspension ───────────────────────────────────────────────────────────


class SuspensionSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    lifted_by_name = serializers.SerializerMethodField()
    outcome_display = serializers.CharField(source="get_outcome_display", read_only=True)

    class Meta:
        model = Suspension
        fields = [
            "id", "employee", "employee_name", "employee_code",
            "starts_on", "ends_on", "reason",
            "is_active", "outcome", "outcome_display", "outcome_note",
            "lifted_on", "lifted_by", "lifted_by_name",
            "created_at", "updated_at",
        ]
        # Everything about *ending* a suspension is written by the `lift`
        # action, never by a PATCH. Two ways to close one is how an account
        # comes to be unlocked with the record still saying it is suspended.
        read_only_fields = [
            "is_active", "outcome", "outcome_note", "lifted_on", "lifted_by",
            "created_at", "updated_at",
        ]

    def get_employee_name(self, obj):
        user = obj.employee.user
        return user.get_full_name() or user.get_username()

    def get_lifted_by_name(self, obj):
        if obj.lifted_by is None:
            return None
        return obj.lifted_by.get_full_name() or obj.lifted_by.get_username()


class LiftSuspensionSerializer(serializers.Serializer):
    """Ending one. `outcome` is required — see `suspensions.lift`."""

    outcome = serializers.ChoiceField(
        choices=[c for c in Suspension.Outcome.choices if c[0] != Suspension.Outcome.PENDING]
    )
    note = serializers.CharField(required=False, allow_blank=True, default="")


# ── Recognition, and its opposite ────────────────────────────────────────


class AwardSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)

    class Meta:
        model = Award
        fields = [
            "id", "employee", "employee_name", "title", "kind", "kind_display",
            "awarded_on", "awarded_by", "citation", "reward", "certificate",
            "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def get_employee_name(self, obj):
        user = obj.employee.user
        return user.get_full_name() or user.get_username()


class DisciplinaryActionSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    severity_display = serializers.CharField(source="get_severity_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    #: Whether it still counts against them today. Computed here rather than in
    #: the browser, because "has it expired" is a date comparison the server is
    #: already making for reports and the two must not disagree.
    is_current = serializers.SerializerMethodField()

    class Meta:
        model = DisciplinaryAction
        fields = [
            "id", "employee", "employee_name", "subject",
            "severity", "severity_display", "status", "status_display",
            "incident_date", "issued_on", "description", "employee_response",
            "action_taken", "expires_on", "suspension", "document", "is_current",
            "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def get_employee_name(self, obj):
        user = obj.employee.user
        return user.get_full_name() or user.get_username()

    def get_is_current(self, obj):
        from datetime import date

        if obj.status in (
            DisciplinaryAction.Status.OVERTURNED,
            DisciplinaryAction.Status.CLOSED,
        ):
            return False
        return obj.expires_on is None or obj.expires_on >= date.today()
