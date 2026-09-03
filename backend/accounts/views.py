from urllib.parse import urlsplit, urlunsplit

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import mixins, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet
from rest_framework_simplejwt.views import TokenObtainPairView

from accounts.policy import permissions_of
from accounts.portal import portal_summary
from accounts.serializers import (
    ChangePasswordSerializer,
    EmployeeExperienceSerializer,
    MyProfileSerializer,
)
from accounts.utils import generate_temp_password
from attendance.permissions import _requesting_employee
from core.email import send_templated_mail
from employees.models import EmployeeExperience

User = get_user_model()


class ThrottledTokenObtainPairView(TokenObtainPairView):
    """Login endpoint with a per-client rate limit (scope 'login') to blunt
    credential brute-forcing. Uses the configured CompanyTokenObtainPair
    serializer via SIMPLE_JWT settings."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"


class MyResumeView(APIView):
    """Download the signed-in user's own uploaded résumé."""

    def get(self, request, **kwargs):
        from django.http import FileResponse

        employee = getattr(request.user, "employee", None)
        if employee is None or not employee.resume:
            return Response({"detail": "No résumé uploaded."}, status=status.HTTP_404_NOT_FOUND)
        response = FileResponse(employee.resume.open("rb"))
        response["Content-Disposition"] = f'inline; filename="{request.user.get_username()}-resume"'
        return response


class ChangePasswordView(APIView):
    """Authenticated password change for the signed-in user."""

    def post(self, request, **kwargs):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Password updated."})


class MyExperienceViewSet(
    mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin, GenericViewSet
):
    """The signed-in user manages their own work-history entries. Always
    scoped to request.user's employee — you can't touch anyone else's."""

    serializer_class = EmployeeExperienceSerializer

    def _employee(self):
        try:
            return self.request.user.employee
        except User.employee.RelatedObjectDoesNotExist:
            return None

    def get_queryset(self):
        employee = self._employee()
        return EmployeeExperience.objects.filter(employee=employee) if employee else EmployeeExperience.objects.none()

    def perform_create(self, serializer):
        serializer.save(employee=self._employee())


class MyProfileView(APIView):
    """The signed-in user's own profile — GET to view, PATCH to edit the
    self-service subset (name/phone/DOB/gender/photo). Accepts multipart
    for the photo upload. 404s if the account has no linked employee
    (e.g. a bare admin) — the frontend falls back to the account basics."""

    def _employee(self, request):
        try:
            return request.user.employee
        except User.employee.RelatedObjectDoesNotExist:
            return None

    def get(self, request, **kwargs):
        employee = self._employee(request)
        if employee is None:
            return Response({"detail": "No employee profile."}, status=status.HTTP_404_NOT_FOUND)
        return Response(MyProfileSerializer(employee).data)

    def patch(self, request, **kwargs):
        employee = self._employee(request)
        if employee is None:
            return Response({"detail": "No employee profile."}, status=status.HTTP_404_NOT_FOUND)
        serializer = MyProfileSerializer(employee, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(MyProfileSerializer(employee).data)


class MeView(APIView):
    """Returns the authenticated user: identity, role and capabilities."""

    def get(self, request, **kwargs):
        try:
            employee = request.user.employee
        except User.employee.RelatedObjectDoesNotExist:
            employee = None
        return Response(
            {
                "id": request.user.pk,
                "username": request.user.get_username(),
                "email": request.user.email,
                "role": request.user.role,
                "is_superuser": request.user.is_superuser,
                "employee_id": employee.id if employee else None,
                # Who this is, in the words a letter would use. Sent here
                # because the memorandum page shows the signed-in person in its
                # "From" line before anything has been saved — and it had only
                # the username to show, which is not what a memorandum is signed
                # with. Falls back to the username for a system account with no
                # employee record.
                "full_name": request.user.get_full_name() or request.user.get_username(),
                "employee_code": (getattr(employee, "employee_code", "") or "") if employee else "",
                # The shell reads this and sends them to change it before
                # anything else. Exposed rather than enforced with a wall:
                # the risk here is a generated password living forever, not
                # somebody reaching a page they should not.
                "must_change_password": request.user.must_change_password,
                # The navigation is built from this. Sent as a list rather than
                # inferred from `role` in the browser, because the browser
                # guessing at authorisation is how a menu and its API drift —
                # and computed per request rather than carried in the JWT, so
                # a capability revoked this morning is gone this morning.
                "permissions": sorted(permissions_of(request.user)),
            }
        )


def _frontend_url(request, path):
    """A link into the frontend, built from `FRONTEND_BASE_URL`.

    One deployment, one address — so this is a setting rather than something
    derived from the request, and a link mailed by a background job matches
    one built inside a request.
    """
    base = urlsplit(settings.FRONTEND_BASE_URL)
    return urlunsplit((base.scheme, base.netloc, path, "", ""))


class PasswordResetRequestView(APIView):
    """Step 1: request a reset — emails a confirmation link. Doesn't
    reveal whether the email exists (always 200)."""

    permission_classes = [AllowAny]

    def post(self, request, **kwargs):
        email = request.data.get("email", "")
        user = User.objects.filter(email__iexact=email).first()
        if user is not None:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            link = _frontend_url(request, "/reset-password/confirm") + f"?uid={uid}&token={token}"
            send_templated_mail(
                "Confirm your HRMS password reset",
                [user.email],
                heading="Password reset requested",
                greeting=f"Hi {user.get_short_name() or user.get_username()},",
                intro="We received a request to reset your HRMS password. Confirm below and a new "
                "temporary password will be generated and emailed to you.",
                cta_label="Confirm password reset",
                cta_url=link,
                outro="If you didn't request this, you can safely ignore this email — your password "
                "won't change.",
            )
        return Response(status=status.HTTP_200_OK)


class PasswordResetConfirmView(APIView):
    """Step 2: confirm via the emailed link — generates a new random
    password, sets it, and emails it to the user."""

    permission_classes = [AllowAny]

    def post(self, request, **kwargs):
        uid = request.data.get("uid", "")
        token = request.data.get("token", "")
        try:
            user_id = force_str(urlsafe_base64_decode(uid))
            user = User.objects.get(pk=user_id)
        except (User.DoesNotExist, ValueError, TypeError, OverflowError):
            return Response(
                {"detail": "Invalid reset link."}, status=status.HTTP_400_BAD_REQUEST
            )

        if not default_token_generator.check_token(user, token):
            return Response(
                {"detail": "This reset link is invalid or has expired."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        new_password = generate_temp_password()
        user.set_password(new_password)
        # Generated by us and mailed in plain text, exactly like a newly
        # provisioned account — so it carries the same obligation to be replaced.
        user.must_change_password = True
        user.save(update_fields=["password", "must_change_password"])

        send_templated_mail(
            "Your new HRMS password",
            [user.email],
            heading="Your password has been reset",
            greeting=f"Hi {user.get_short_name() or user.get_username()},",
            intro="Here is your new temporary password. Sign in with it and change it right away.",
            facts=[{"label": "Temporary password", "value": new_password}],
            cta_label="Log in to HRMS",
            cta_url=_frontend_url(request, "/login"),
            outro="If you didn't request this reset, please contact your HR administrator.",
        )
        return Response(status=status.HTTP_200_OK)


# --- Opt-in TOTP 2FA (see core/totp.py) --------------------------------------
from core.totp import consume_backup_code as _consume_backup  # noqa: E402
from core.totp import (  # noqa: E402
    generate_backup_codes,
    hash_codes,
    new_secret,
    otpauth_uri,
    qr_data_uri,
    verify_code,
)


class TwoFactorStatusView(APIView):
    """GET current 2FA state for the signed-in user."""

    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        u = request.user
        return Response(
            {"enabled": u.totp_enabled, "backup_codes_remaining": len(u.backup_codes or [])}
        )


class TwoFactorSetupView(APIView):
    """Begin enrolment: mint a secret (not yet active) + return the QR/URI to
    scan. Enable is a separate step that proves the user scanned it."""

    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        u = request.user
        if u.totp_enabled:
            return Response({"detail": "Two-factor is already enabled."}, status=400)
        secret = new_secret()
        u.totp_secret = secret
        u.save(update_fields=["totp_secret"])
        uri = otpauth_uri(secret, u.email or u.get_username())
        return Response({"secret": secret, "otpauth_uri": uri, "qr": qr_data_uri(uri)})


class TwoFactorEnableView(APIView):
    """Confirm enrolment: verify a code against the pending secret, then turn
    2FA on and hand back one-time backup codes (shown once)."""

    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        u = request.user
        if not u.totp_secret:
            return Response({"detail": "Start setup first."}, status=400)
        if not verify_code(u.totp_secret, request.data.get("code", "")):
            return Response({"detail": "That code didn't match. Try again."}, status=400)
        codes = generate_backup_codes()
        u.backup_codes = hash_codes(codes)
        u.totp_enabled = True
        u.save(update_fields=["totp_enabled", "backup_codes"])
        return Response({"enabled": True, "backup_codes": codes})


class TwoFactorDisableView(APIView):
    """Turn 2FA off — requires a current authenticator or backup code so a
    hijacked *session* can't silently strip the second factor."""

    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        u = request.user
        if not u.totp_enabled:
            return Response({"enabled": False})
        code = request.data.get("code", "")
        ok = verify_code(u.totp_secret, code)
        if not ok:
            ok, _ = _consume_backup(code, u.backup_codes or [])
        if not ok:
            return Response({"detail": "Enter a valid code to disable two-factor."}, status=400)
        u.totp_enabled = False
        u.totp_secret = ""
        u.backup_codes = []
        u.save(update_fields=["totp_enabled", "totp_secret", "backup_codes"])
        return Response({"enabled": False})

class PortalSummaryView(APIView):
    """Everything about the signed-in employee, for one fiscal year.

    Deliberately has no employee parameter. The subject is always whoever is
    calling, which is the only reliable way to keep a self-service surface
    self-service — there is no id to tamper with.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        employee = _requesting_employee(request.user)
        if employee is None:
            # An HR admin who is not themselves an employee is a real
            # configuration, and answering 404 here is clearer than an empty
            # portal that looks broken.
            return Response(
                {
                    "detail": "This account has no employee record, so there is no personal view to show.",
                    "code": "no_employee_record",
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        raw_year = request.query_params.get("fiscal_year")
        fiscal_year = None
        if raw_year:
            try:
                fiscal_year = int(raw_year)
            except ValueError:
                return Response(
                    {"detail": "fiscal_year must be a year, e.g. 2083."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        return Response(portal_summary(employee, fiscal_year=fiscal_year))
