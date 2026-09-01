"""Who may do what — the one place that decides.

**Why one place.** Written inline, the check `user.is_superuser or user.role
== HR_ADMIN` reappears in every file that needs it — fifty-one sites across
twenty-three files, some as a locally redefined `_is_hr()`. Then there is
nowhere to change what "HR" means, and adding a role means finding all of them
and hoping. Authorisation spread across a codebase is the one thing nobody can
verify by reading.

**Three layers, and keeping them apart is the whole design.**

| Layer | Answers | Example |
|---|---|---|
| Role | where you sit | owner · hr_admin · hr_officer · employee |
| Permission | what you may do | `payroll.run`, `leave.approve` |
| Verb | how far | view · edit · create · delete |
| Scope | over whom | the manager relationship |

Scope is **orthogonal**, and that is the part usually got wrong: being
somebody's manager gives reach over their records without granting any
capability, and holding `leave.approve` with no reports approves nothing.

**Why individual grants rather than named bundles.** A bundle means a wrong
grant is shared with everybody else holding that bundle, and fixing it either
breaks them or forks the bundle. A grant is one row, revoked on its own.

**Why the permission list is short.** Fifteen, not fifty. (It was thirteen when
this was written; `mail.access` and `dashboard.view` were split out afterwards
for reasons recorded on each. The count is quoted on the public page, so it is
worth keeping true here rather than approximately true.) A permission per
viewset would be an authorisation model nobody can hold in their head, and one
nobody can hold in their head is one nobody audits.
"""

class Perm:
    """Every capability in the product. Deliberately a short list."""

    # People and the employment record
    PEOPLE_VIEW = "people.view"
    PEOPLE_MANAGE = "people.manage"
    #: Appoint roles and grant permissions. **Never grantable** — see `grant`.
    PEOPLE_ADMIN = "people.admin"

    # Money
    PAYROLL_VIEW = "payroll.view"
    PAYROLL_RUN = "payroll.run"
    EXPENSES_MANAGE = "expenses.manage"

    # Time
    ATTENDANCE_MANAGE = "attendance.manage"
    LEAVE_APPROVE = "leave.approve"

    # Everything else HR does
    RECRUITMENT_MANAGE = "recruitment.manage"
    REPORTS_VIEW = "reports.view"
    SETTINGS_MANAGE = "settings.manage"
    CRM_MANAGE = "crm.manage"
    #: Read and send from the **company mailbox**.
    #:
    #: Its own capability rather than riding on `PEOPLE_MANAGE`, which is what
    #: gated it before. Those are different questions: somebody who maintains
    #: employment records is not automatically somebody who should read every
    #: message the company receives, and the reverse holds too — a finance or
    #: secretariat person may need the mailbox and have no business editing
    #: people. Splitting it is also the only way the owner can *decide*: with
    #: one permission covering both, "who can check mail" had no answer to give.
    MAIL_ACCESS = "mail.access"
    #: Assets, training, surveys, goals, checklists, timesheets, WFH, helpdesk.
    #: One permission rather than eight: these are the carried modules, and
    #: splitting them invents distinctions no customer has asked for. Split it
    #: the day one does.
    WORKPLACE_MANAGE = "workplace.manage"

    #: Seeing the company dashboard at all. Its own permission because §4.0i
    #: settles that employees do not land on one.
    DASHBOARD_VIEW = "dashboard.view"


ALL_PERMS = [
    value for name, value in vars(Perm).items() if not name.startswith("_") and isinstance(value, str)
]

#: Held by anyone with the role, without a grant row.
#:
#: `hr_officer` is deliberately empty. An officer with no grants can do exactly
#: what an employee can — "as per their scope" only means something if the
#: default scope is nothing.
ROLE_PERMISSIONS = {
    "owner": set(ALL_PERMS),
    "hr_admin": set(ALL_PERMS),
    "hr_officer": set(),
    "employee": set(),
}

#: Not grantable to anybody, ever. A grantable "grant permissions" is how an
#: officer becomes an admin in two steps.
NEVER_GRANTABLE = {Perm.PEOPLE_ADMIN}


# ── The verb: what holding a permission actually lets you do ─────────────
#
# **An officer operates the system; an admin shapes it.** Both hold
# `payroll.view`; only one of them may invent a new tax slab. Expressed as a
# second axis rather than by doubling the permission list, because
# `payroll.run` and `payroll.run.create` would be fifteen more names to audit
# and the distinction is the same one every time.
#
# The rule, in the owner's words: an HR officer may operate — read, edit,
# process. Bringing something new into existence, and removing anything, is
# the admin's.

#: May create new records of a kind they hold the permission for.
CAN_CREATE_ROLES = {"owner", "hr_admin"}

#: May delete. The same set, and deliberately not a superset — deletion is the
#: one act with no undo, so it never widens.
CAN_DELETE_ROLES = {"owner", "hr_admin"}


class PermissionError_(Exception):
    """The actor may not do that. Named with a trailing underscore so it cannot
    shadow the builtin at an import site."""


# `PermissionGrant` itself lives in `accounts/models.py`, where Django looks
# for models. The rules about it live here, so that changing what a grant
# *means* never involves opening a models file.


# ── The one question ─────────────────────────────────────────────────────


def can(user, permission):
    """May this user do this thing? The only authorisation question in the app."""
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    if not user.is_active:
        return False

    # Superuser maps *onto* the model rather than sitting beside it as a
    # bypass — otherwise there are two authorisation systems and only one of
    # them is audited.
    if user.is_superuser:
        return True

    role = getattr(user, "role", "employee")

    # The owner is checked before any map. A capability added next month must
    # not be able to lock somebody out of the workspace they own.
    if role == "owner":
        return True

    if permission in ROLE_PERMISSIONS.get(role, set()):
        return True

    return user.permission_grants.filter(permission=permission).exists()


def _role_of(user):
    return getattr(user, "role", "employee")


def can_create(user, permission):
    """May this user bring a *new* record of this kind into existence?

    `can` and then the role, in that order. Holding the permission is still
    required — an officer granted nothing creates nothing — and the role is
    what decides whether holding it extends this far.
    """
    if not can(user, permission):
        return False
    return user.is_superuser or _role_of(user) in CAN_CREATE_ROLES


def can_delete(user, permission):
    """May this user delete a record of this kind? Same shape as `can_create`."""
    if not can(user, permission):
        return False
    return user.is_superuser or _role_of(user) in CAN_DELETE_ROLES


def users_with(permission):
    """Every active user who may do this thing.

    **The plural of `can`, and it has to stay that way.** Seven modules needed
    "who should hear about this?" and each answered it with
    `User.objects.filter(role=HR_ADMIN)` — the same fifty-one-site pattern
    `can` was built to end, surviving in the one shape that reads as a query
    rather than as an authorisation check.

    That filter is wrong in both directions. It misses an **owner**, who holds
    every permission by definition — on a workspace whose only user is its
    owner, every one of those notifications went to nobody. And it misses an
    **hr_officer** holding exactly the grant that makes them the right
    recipient, which is the entire point of granting it.

    Ask for the capability the work actually needs — `leave.approve` for a
    leave request, not "HR" — so the answer follows the grant.

    Mirrors `can` clause for clause: superuser, owner, the role map, then an
    explicit grant. If one gains a clause, so must the other.
    """
    from django.db.models import Q

    from accounts.models import User

    if permission not in ALL_PERMS:
        raise PermissionError_(f"No such permission: {permission}")

    roles = [r for r, perms in ROLE_PERMISSIONS.items() if permission in perms]
    match = Q(is_superuser=True) | Q(role="owner") | Q(permission_grants__permission=permission)
    if roles:
        match |= Q(role__in=roles)
    return User.objects.filter(is_active=True).filter(match).distinct()


def permissions_of(user):
    """Everything this user may do — for the nav, which is built from it."""
    if user is None or not getattr(user, "is_authenticated", False) or not user.is_active:
        return set()
    if user.is_superuser or getattr(user, "role", None) == "owner":
        return set(ALL_PERMS)
    role_perms = set(ROLE_PERMISSIONS.get(getattr(user, "role", "employee"), set()))
    granted = set(user.permission_grants.values_list("permission", flat=True))
    return role_perms | granted


def require(user, permission):
    """`can`, raising instead of returning False."""
    if not can(user, permission):
        raise PermissionError_(f"This account does not have “{permission}”.")
    return True


# ── Scope: reach without capability ──────────────────────────────────────


def manages(user, employee):
    """Is this user the employee's manager? A question about *reach*.

    Kept apart from `can` on purpose. Being a manager does not grant a
    capability, and holding a capability does not make you anybody's manager —
    conflating them produces either managers who can run payroll or approvers
    with nobody to approve.
    """
    if user is None or employee is None:
        return False
    own = getattr(user, "employee", None)
    return own is not None and employee.manager_id == own.id


# ── Delegation ───────────────────────────────────────────────────────────


def grant(actor, user, permission):
    """Give somebody a capability.

    Two rules, and the second is the one that matters:

    - the actor must hold `people.admin`
    - **the actor must hold the permission they are handing out.** Without
      this, an admin lacking payroll access could grant it to an officer and
      act through them — delegation becoming privilege escalation in one hop.
    """
    if permission not in ALL_PERMS:
        raise PermissionError_(f"No such permission: {permission}")
    if permission in NEVER_GRANTABLE:
        raise PermissionError_(
            f"“{permission}” cannot be granted to anybody — it is held by role alone."
        )
    require(actor, Perm.PEOPLE_ADMIN)
    if not can(actor, permission):
        raise PermissionError_(
            f"You cannot grant “{permission}” because you do not hold it yourself."
        )

    from accounts.models import PermissionGrant

    obj, _ = PermissionGrant.objects.get_or_create(
        user=user, permission=permission, defaults={"granted_by": actor}
    )
    return obj


def revoke(actor, user, permission):
    """Take a capability back. Revoking needs only `people.admin`.

    Asymmetric with `grant` deliberately: you should always be able to remove a
    capability you can see, even one you do not hold yourself. Requiring the
    permission to revoke it would mean a mistaken grant outlives the person who
    can see it is wrong.
    """
    from accounts.models import PermissionGrant

    require(actor, Perm.PEOPLE_ADMIN)
    PermissionGrant.objects.filter(user=user, permission=permission).delete()


def set_role(actor, user, role):
    """Appoint somebody.

    **Who may appoint whom.** The owner appoints anybody. An HR admin appoints
    officers and employees — they can promote somebody to officer and demote
    them again — but cannot mint another admin, because an admin who can create
    admins is an owner by a longer route.

    Owner is not appointable at all: it is the account the system was set up
    with, and a role that can be handed out is not a root of trust.
    """
    if role not in ROLE_PERMISSIONS:
        raise PermissionError_(f"No such role: {role}")
    if role == "owner":
        raise PermissionError_(
            "The owner is set when the system is installed and cannot be appointed."
        )
    require(actor, Perm.PEOPLE_ADMIN)

    if user.role == "owner":
        raise PermissionError_("The owner's role cannot be changed.")

    actor_role = _role_of(actor)
    if role == "hr_admin" and not (actor.is_superuser or actor_role == "owner"):
        raise PermissionError_("Only the owner can appoint an HR admin.")
    # Symmetrically: an admin may not demote another admin either, or two
    # admins can take turns removing each other.
    if user.role == "hr_admin" and not (actor.is_superuser or actor_role == "owner"):
        raise PermissionError_("Only the owner can change an HR admin's role.")

    user.role = role
    user.save(update_fields=["role"])

    # Grants only mean anything for an officer. Moving to any other role makes
    # them either redundant (an admin holds everything anyway) or dangerous (an
    # employee keeping `payroll.run` because nobody thought to revoke it), so
    # they go with the role.
    if role != "hr_officer":
        from accounts.models import PermissionGrant

        PermissionGrant.objects.filter(user=user).delete()
    return user
