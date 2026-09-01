"""Creating, activating and revoking the login that belongs to an employee.

**One path, called from both routes that add a person** — the manual
create-employee form and converting a hired candidate. Written twice, the two
drift over the thing that matters least visibly: whether the person can
actually sign in. A route that generates a password, sets it and tells nobody
produces a candidate with a perfect employee record, an onboarding checklist,
and no way in. Each copy reads fine on its own, which is why the drift is
invisible.

**An account's life is three moments** — created, activated (the person
replaces the password we chose for them), and revoked. All three live here, so
the last cannot be the one nobody remembers to call.
"""

import logging

from django.conf import settings
from django.contrib.auth import get_user_model

from accounts.utils import generate_temp_password
from core.email import send_templated_mail

logger = logging.getLogger(__name__)


class AccountError(Exception):
    """The account cannot be created as things stand."""


def unique_username(base):
    """A username nobody else holds, derived from the email local part.

    Lived in two files before this one, with the same off-by-one: the suffix
    counter started at 1 and was incremented *before* first use, so the second
    `ram` became `ram2`. Kept exactly, because changing it now would rename
    nobody but would make new accounts inconsistent with the ones already
    issued.
    """
    User = get_user_model()
    base = (base or "user").strip().lower().replace(" ", ".")[:24] or "user"
    username = base
    suffix = 1
    while User.objects.filter(username=username).exists():
        suffix += 1
        username = f"{base}{suffix}"
    return username


def provision_account(*, email, first_name="", last_name="", role=None, password=None, send_mail=True):
    """Create the login for a new employee and hand them the credentials.

    Returns the `User`. The temporary password is deliberately **not** returned
    to the caller and never appears in an API response — the person it belongs
    to is the only one who needs it, and an endpoint that echoes a password puts
    it into logs, proxies and browser history on the way past.

    `send_mail=False` exists for seeding and tests, not for callers who would
    rather deliver it themselves.
    """
    User = get_user_model()

    if not email:
        # The email *is* the login. Inventing a placeholder produces somebody
        # who can never sign in and a support ticket nobody can explain.
        raise AccountError("An email address is required to create a login.")

    if User.objects.filter(email__iexact=email).exists():
        raise AccountError(f"Somebody already has the email {email} in this workspace.")

    temp_password = password or generate_temp_password()
    user = User.objects.create_user(
        username=unique_username(email.split("@")[0]),
        email=email,
        first_name=first_name,
        last_name=last_name,
        password=temp_password,
        role=role or User.Role.EMPLOYEE,
        # We chose this password, so it is a credential to be replaced rather
        # than a password to be kept — true whether or not the mail goes out.
        must_change_password=True,
    )

    if send_mail:
        send_credentials(user, temp_password)
    return user


def send_credentials(user, temp_password):
    """Mail somebody the password we generated for them.

    Separate from creation so HR can re-issue without rebuilding the account,
    and because `send_templated_mail` **never raises** — a mail server being
    down must not roll back an employee who has already been hired. The failure
    is logged and the account stands; the alternative is a conversion that
    half-succeeds and leaves a candidate hired in one table and absent from
    another.
    """
    send_templated_mail(
        "Welcome to HRMS — your account",
        [user.email],
        heading="Welcome to HRMS",
        greeting=f"Hi {user.get_short_name() or user.get_username()},",
        intro="An HRMS account has been created for you. Use the credentials below to sign in.",
        facts=[
            {"label": "Username", "value": user.get_username()},
            {"label": "Temporary password", "value": temp_password},
        ],
        cta_label="Log in to HRMS",
        cta_url=settings.FRONTEND_BASE_URL,
        outro="You will be asked to choose your own password the first time you sign in.",
    )


def revoke_access(user, *, reason=""):
    """Close the login when somebody leaves.

    **Deliberately not the same question as whether they are paid.** The final
    payslip is computed after the last working day, and payroll selects on the
    employee record rather than on `is_active`, so closing the login here cannot
    drop somebody from the run that still owes them money.

    Idempotent: applying the same lifecycle event twice must not be an error.
    """
    if user is None or not user.is_active:
        return user
    user.is_active = False
    user.save(update_fields=["is_active"])
    logger.info("Access revoked for %s%s", user.get_username(), f" ({reason})" if reason else "")
    return user


def restore_access(user):
    """Re-open a closed login — a rescinded termination, or a rejoiner.

    Here because the pair belongs together: a revocation with no matching
    restore is how somebody ends up locked out with no route back that does not
    involve a database console.
    """
    if user is None or user.is_active:
        return user
    user.is_active = True
    user.save(update_fields=["is_active"])
    logger.info("Access restored for %s", user.get_username())
    return user
