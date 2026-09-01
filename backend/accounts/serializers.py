import json

from django.contrib.auth import get_user_model
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from core.totp import consume_backup_code, verify_code
from employees.models import EmployeeExperience

User = get_user_model()


def _enforce_2fa(user, otp):
    """Raise a 401 unless `otp` satisfies an account with 2FA enabled.
    A missing code -> {"otp_required": true}; a wrong one -> same flag so
    the frontend keeps the code field shown."""
    if not getattr(user, "totp_enabled", False):
        return
    otp = (otp or "").strip()
    if not otp:
        raise AuthenticationFailed({"otp_required": True, "detail": "Two-factor code required."})
    if verify_code(user.totp_secret, otp):
        return
    ok, remaining = consume_backup_code(otp, user.backup_codes or [])
    if ok:
        user.backup_codes = remaining  # one-time use — burn it
        user.save(update_fields=["backup_codes"])
        return
    raise AuthenticationFailed({"otp_required": True, "detail": "Invalid two-factor code."})


class MyProfileSerializer(serializers.Serializer):
    """The signed-in user's own profile — a self-service subset they may
    edit (name, phone, DOB, gender, photo, cover, bio, address, skills).
    HR-controlled fields (department, designation, manager, employment
    status, code) are read-only here and only editable through the HR
    employee form. Read also returns work experiences and recent activity
    (from the EmployeeLog audit trail) for the rich profile page."""

    # account (User)
    first_name = serializers.CharField(required=False, allow_blank=True)
    last_name = serializers.CharField(required=False, allow_blank=True)
    username = serializers.CharField(source="user.username", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    role = serializers.CharField(source="user.role", read_only=True)

    # employee (self-editable)
    phone = serializers.CharField(required=False, allow_blank=True)
    date_of_birth = serializers.DateField(required=False, allow_null=True)
    gender = serializers.CharField(required=False, allow_blank=True)
    photo = serializers.ImageField(required=False, allow_null=True)
    cover_image = serializers.ImageField(required=False, allow_null=True)
    #: Where the crop sits. Self-editable, unlike the fields in Record on file —
    #: moving your own banner cannot send anybody's salary anywhere.
    cover_position = serializers.CharField(required=False, allow_blank=True, max_length=20)
    resume = serializers.FileField(required=False, allow_null=True)
    bio = serializers.CharField(required=False, allow_blank=True)
    address = serializers.CharField(required=False, allow_blank=True)
    city = serializers.CharField(required=False, allow_blank=True)
    country = serializers.CharField(required=False, allow_blank=True)
    # Sent as a JSON-encoded string so it rides in the same multipart
    # request as the photo/cover uploads; read back as a real list.
    skills = serializers.CharField(required=False, allow_blank=True, write_only=True)

    # employee (read-only context)
    employee_code = serializers.CharField(read_only=True)
    date_joined = serializers.DateField(read_only=True)
    employment_status = serializers.CharField(read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    designation_title = serializers.CharField(source="designation.title", read_only=True, default=None)
    manager_name = serializers.SerializerMethodField()
    probation_end_date = serializers.DateField(read_only=True)

    # ── The record about you that you could not see ───────────────────────
    #
    # The bank fields, the statutory numbers, the citizenship details and the
    # legal name. These are the fields somebody most needs to check are right
    # about themselves — a wrong account number is a salary paid to a stranger,
    # a wrong PAN is a filing that fails — so the person they describe can read
    # them here, as HR can on `/employees/[id]`.
    #
    # **Read-only here, on purpose.** They are not "not editable" — they go
    # through `EmployeeChangeRequest`, because a bank account changed silently
    # the day before payroll is exactly the loss that flow exists to prevent.
    # Showing them read-only next to a "request a change" action is the whole
    # point: you can see what is on file and ask for it to be corrected.
    legal_first_name = serializers.CharField(read_only=True)
    legal_middle_name = serializers.CharField(read_only=True)
    legal_last_name = serializers.CharField(read_only=True)
    marital_status = serializers.CharField(read_only=True)
    citizenship_number = serializers.CharField(read_only=True)
    passport_number = serializers.CharField(read_only=True)
    passport_expiry = serializers.DateField(read_only=True)

    #: What payroll files against. Blank here is itself worth seeing — a missing
    #: SSF number is why a return will not go in.
    pan_number = serializers.CharField(read_only=True)
    ssf_number = serializers.CharField(read_only=True)
    pf_number = serializers.CharField(read_only=True)
    cit_number = serializers.CharField(read_only=True)
    tax_election = serializers.CharField(read_only=True)

    bank_name = serializers.CharField(read_only=True)
    bank_branch = serializers.CharField(read_only=True)
    bank_account_name = serializers.CharField(read_only=True)
    bank_account_type = serializers.CharField(read_only=True)

    def get_manager_name(self, employee):
        manager = employee.manager
        if manager is None:
            return None
        return manager.user.get_full_name() or manager.user.get_username()

    def to_representation(self, employee):
        data = super().to_representation(employee)
        user = employee.user
        data["first_name"] = user.first_name
        data["last_name"] = user.last_name
        data["full_name"] = user.get_full_name() or user.get_username()
        data["photo"] = employee.photo.url if employee.photo else None
        data["cover_image"] = employee.cover_image.url if employee.cover_image else None
        data["cover_position"] = employee.cover_position or "50% 50%"
        data["resume"] = employee.resume.url if employee.resume else None
        data["bio"] = employee.bio
        data["address"] = employee.address
        data["city"] = employee.city
        data["country"] = employee.country
        data["skills"] = employee.skills or []

        # Masked even from its owner, and deliberately: a full account number is
        # only needed to *build a payment file*, which is a server-side job. The
        # last four are enough to confirm it is the right account, which is the
        # only question somebody asks of their own. Same rule and same shape as
        # `EmployeeDetailSerializer` — stated in both places rather than shared,
        # because a helper that silently unmasked would be worse than a repeat.
        account = employee.bank_account_number or ""
        data["bank_account_number"] = f"****{account[-4:]}" if account else ""

        # Present or not, rather than the file itself. Whether a scan is on file
        # is the useful answer here; retrieving it is what the documents screen
        # is for, and it applies its own visibility rules and access log.
        data["citizenship_front_on_file"] = bool(employee.citizenship_front)
        data["citizenship_back_on_file"] = bool(employee.citizenship_back)
        # Through the serializer rather than a dict literal: this payload and
        # the employee record page were building the same six keys by hand, so
        # a seventh field added to the model appeared on neither.
        data["experiences"] = EmployeeExperienceSerializer(
            employee.experiences.all(), many=True
        ).data
        data["activity"] = [
            {
                "id": log.id,
                "field": log.field,
                "from_value": log.from_value,
                "to_value": log.to_value,
                "actor": (log.actor.get_full_name() or log.actor.get_username()) if log.actor else None,
                "created_at": log.created_at.isoformat(),
            }
            for log in employee.logs.order_by("-created_at")[:10]
        ]
        return data

    def update(self, employee, validated):
        user = employee.user
        if "first_name" in validated:
            user.first_name = validated["first_name"]
        if "last_name" in validated:
            user.last_name = validated["last_name"]
        user.save(update_fields=["first_name", "last_name"])

        if "skills" in validated:
            try:
                employee.skills = json.loads(validated.pop("skills") or "[]")
            except (ValueError, TypeError):
                employee.skills = []
        for field in (
            "phone", "date_of_birth", "gender", "photo", "cover_image",
            "cover_position", "resume", "bio", "address", "city", "country",
        ):
            if field in validated:
                setattr(employee, field, validated[field])
        employee.save()
        return employee


class EmployeeExperienceSerializer(serializers.ModelSerializer):
    """One post somebody has held.

    `kind` separates a job at a previous employer from a post held inside this
    company — the same six facts with different provenance. See
    `EmployeeExperience` for why that is a field rather than a second model.
    """

    class Meta:
        model = EmployeeExperience
        fields = [
            "id", "kind", "title", "company", "start_year", "end_year",
            "description", "is_verified",
        ]


class ChangePasswordSerializer(serializers.Serializer):
    """Authenticated self-service password change (distinct from the
    email-based reset flow). Verifies the current password and runs the
    new one through Django's configured validators."""

    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_old_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate_new_password(self, value):
        from django.contrib.auth.password_validation import validate_password

        validate_password(value, self.context["request"].user)
        return value

    def save(self, **kwargs):
        user = self.context["request"].user
        user.set_password(self.validated_data["new_password"])
        # This is the moment the password stops being one the system chose and
        # becomes one the person did — which is exactly what the flag tracks.
        user.must_change_password = False
        user.save(update_fields=["password", "must_change_password"])
        return user


class HRMSTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Sign-in, with the second factor enforced where the account has one.

    When the user has opted into TOTP 2FA, password auth alone is not
    enough: a valid `otp` (authenticator code or a one-time backup code)
    must accompany the request. A missing code yields a distinct
    `otp_required` 401 so the frontend can prompt for the second factor.
    """

    def validate(self, attrs):
        # A suspended account is already refused — `employees.suspensions` sets
        # `User.is_active`, and SimpleJWT will not issue a token for an
        # inactive user. But it refuses with "No active account found with the
        # given credentials", which is indistinguishable from a typo, so
        # somebody who has been suspended spends the morning resetting a
        # password that was never wrong. This says the true thing instead.
        #
        # Checked *before* `super()`, because the parent raises on the inactive
        # flag and never reaches this line otherwise. Safe to answer without a
        # verified password: it is keyed on the username somebody typed, and
        # tells them only what their own HR already told them.
        self._explain_suspension(attrs.get(User.USERNAME_FIELD, ""))
        data = super().validate(attrs)  # verifies password, sets self.user
        _enforce_2fa(self.user, self.initial_data.get("otp", ""))
        return data

    @staticmethod
    def _explain_suspension(username):
        from employees.suspensions import active_suspension

        user = User.objects.filter(**{User.USERNAME_FIELD: username}).first()
        if user is None or user.is_active:
            return
        employee = getattr(user, "employee", None)
        if employee is None:
            return
        suspension = active_suspension(employee)
        if suspension is None:
            return
        until = (
            f"until {suspension.ends_on:%d %b %Y}"
            if suspension.ends_on
            else "until further notice"
        )
        raise AuthenticationFailed({
            "detail": f"This account is suspended {until}. Contact HR.",
            "code": "account_suspended",
        })
