from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Company-scoped user. Lives in the company's own schema."""

    class Role(models.TextChoices):
        #: One per company, from signup. Not a job title — a root of trust, and
        #: the only role that can appoint HR admins. Checked before any
        #: permission map so a capability added next month cannot lock somebody
        #: out of the workspace they own.
        OWNER = "owner", "Owner"
        HR_ADMIN = "hr_admin", "HR Admin"
        #: Carries nothing by itself. An officer with no grants can do exactly
        #: what an employee can — which is the point: "as per their scope" only
        #: means something if the default scope is empty.
        HR_OFFICER = "hr_officer", "HR Officer"
        EMPLOYEE = "employee", "Employee"

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.EMPLOYEE)

    # Set whenever the system, rather than the person, chose the password:
    # provisioning a new employee and confirming a password reset both mail a
    # generated one in plain text. Asking politely in that email was the whole
    # enforcement until now, so a machine-generated password could stay the
    # real one indefinitely.
    #
    # Default False, not True: existing accounts chose their own passwords and
    # must not be marched through a change screen by a migration.
    must_change_password = models.BooleanField(default=False)

    # --- Opt-in TOTP 2FA (see core/totp.py). Default off: no lock-out risk. ---
    totp_secret = models.CharField(max_length=64, blank=True)
    totp_enabled = models.BooleanField(default=False)
    backup_codes = models.JSONField(default=list, blank=True)  # hashed, one-time


class PermissionGrant(models.Model):
    """One capability, given to one person, by somebody who already held it.

    Rows only exist for `hr_officer`: roles that hold everything implicitly do
    not need grants, and roles that hold nothing do not get them.

    **Individual grants rather than named bundles**, deliberately. A bundle
    means a wrong grant is shared with everybody else holding that bundle, and
    fixing it either breaks them or forks the bundle. A grant is one row, and
    it is revoked on its own.

    The rules — who may grant what, and what can never be granted — live in
    `accounts/policy.py`, so changing what a grant *means* never involves
    opening this file.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="permission_grants"
    )
    permission = models.CharField(max_length=64)
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="permissions_granted",
    )
    granted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "permission"], name="unique_user_permission")
        ]
        ordering = ["user", "permission"]

    def __str__(self):
        return f"{self.user} → {self.permission}"
