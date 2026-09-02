"""DRF permission classes. All of them ask `accounts.policy`, which decides.

**What you are doing matters, not just what you may touch.** An HR officer
holding `people.manage` may edit an employee and may not create one — see the
"verb" section of `accounts/policy.py` for why that is a second axis rather
than more permissions. Putting the mapping here, once, is what makes it true of
every viewset instead of the ones somebody remembered.

**Why the verb comes from the viewset action, not from the HTTP method.** POST
means two different things in this API: `POST /employees/` brings a person into
existence, and `POST /leave-requests/12/approve/` is somebody doing their job.
Gating on the method alone would stop an officer approving leave, running
payroll or clocking anybody in — which is precisely the operating they are
supposed to do. DRF puts the routed action on the view, so `create` and
`destroy` are distinguishable from every custom `@action`, and that is what is
read here.

The gap this leaves, stated so it is not a surprise: a custom action that
deletes things — a bulk-remove endpoint, say — is not caught by the `destroy`
branch and must gate itself.
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission

from accounts.policy import Perm, can, can_create, can_delete


def _check(user, permission, view, method):
    """The capability, read through the verb this request actually performs."""
    action = getattr(view, "action", None)
    if action == "create":
        return can_create(user, permission)
    if action == "destroy":
        return can_delete(user, permission)
    # A plain `APIView` has no `action`. There, DELETE means what it says.
    if action is None and method == "DELETE":
        return can_delete(user, permission)
    return can(user, permission)


def _refusal(view, method):
    """The sentence that fits the verb that was actually refused.

    One message for three different rules sent an officer who had just been
    told "may not create or delete" hunting for a delete button on a form they
    were editing. An officer *can* edit; what they cannot do is add or remove.
    Saying which is the difference between a rule and an apparent bug.
    """
    action = getattr(view, "action", None)
    if action == "create":
        return "This account may not create records of this kind."
    if action == "destroy" or (action is None and method == "DELETE"):
        return "This account may not delete records of this kind."
    return "This account may not change records of this kind."


class IsHRAdminOrReadOnly(BasePermission):
    """Anyone authenticated may read; writing needs a capability.

    **Asks `accounts.policy`, which is the only thing that decides.** Spelling
    the rule out here — `user.is_superuser or user.role == HR_ADMIN` — puts a
    copy of it in every file that needs it, and copies drift.

    A viewset names the capability it gates with `required_permission`; the
    default is deliberately broad, because a viewset that has not said what it
    protects should not accidentally protect *less* than it did before.
    """

    default_permission = Perm.PEOPLE_MANAGE

    #: The message is the point of the class for an officer: a bare "you do not
    #: have permission" on a create, from somebody who *can* edit the same
    #: record, reads as a bug rather than as the rule it is. Which refusal it
    #: is comes from the verb — see `_refusal`.
    message = "This account may not change records of this kind."

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        permission = getattr(view, "required_permission", self.default_permission)
        allowed = _check(request.user, permission, view, request.method)
        if not allowed:
            self.message = _refusal(view, request.method)
        return allowed


class IsHRAdmin(BasePermission):
    """The same, in both directions — reads included.

    For surfaces that are not safe to show every employee: the company mailbox,
    for instance, uses the company's real shared credentials and carries inbound
    mail nobody consented to share.
    """

    default_permission = Perm.PEOPLE_MANAGE

    def has_permission(self, request, view):
        return _check(
            request.user,
            getattr(view, "required_permission", self.default_permission),
            view,
            request.method,
        )


class IsOwner(BasePermission):
    """The owner alone — for the few things nobody else may do.

    Appointing an HR admin is the one that matters: an admin who can create
    admins is an owner by a longer route, so that decision stays with the
    account the system was installed under.
    """

    message = "Only the owner can do this."

    def has_permission(self, request, view):
        user = request.user
        return bool(
            getattr(user, "is_authenticated", False)
            and user.is_active
            and (user.is_superuser or getattr(user, "role", None) == "owner")
        )
