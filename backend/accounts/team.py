"""Appointing roles and granting capabilities — the delegation the model assumes.

**Why this module exists.** `accounts.policy` has had `set_role`, `grant` and
`revoke` since the permission model landed, correct and tested, reachable from
nothing. No viewset, no serializer, no URL. So the sentence the whole design
rests on — the owner appoints HR admins, an admin grants an officer exactly
what they need — was true of the code and false of the product: the only way to
appoint anybody was `manage.py shell`.

**What this deliberately does not do.** It does not re-decide anything. Every
rule lives in `policy` — that grants require holding what you hand out, that
`people.admin` is never grantable, that an owner cannot be demoted, that moving
somebody out of `hr_officer` drops their grants. This module is transport: it
finds the user, calls the function, and turns `PermissionError_` into a 403
carrying the reason. A rule enforced in a view is a rule the next caller skips.

**The catalogue is served, not hardcoded.** The browser needs the permission
list and the role list to render anything, and a second copy in TypeScript is
one that drifts — the same reason the calendar month names come from the
server. `GET /team/catalogue/` is that list, from `policy` itself.
"""

from django.db.models import Prefetch
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import PermissionGrant, User
from accounts.permissions import IsHRAdmin
from accounts.policy import (
    ALL_PERMS,
    NEVER_GRANTABLE,
    ROLE_PERMISSIONS,
    Perm,
    PermissionError_,
    grant,
    permissions_of,
    revoke,
    set_role,
)


def _member(user):
    """One row of the team list.

    `permissions` is what they may actually do, `grants` only what was handed
    to them explicitly. The screen needs both: an admin holds everything by
    role, and showing that as thirteen grants they could revoke would invite
    somebody to try and be confused when nothing changes.
    """
    employee = getattr(user, "employee", None)
    return {
        "id": user.id,
        "username": user.get_username(),
        "name": user.get_full_name() or user.get_username(),
        "email": user.email,
        "role": user.role,
        # `TextChoices` already carries the label; a second map here is a
        # second thing to update when a role is renamed.
        "role_label": user.get_role_display(),
        "is_active": user.is_active,
        "employee_code": getattr(employee, "employee_code", None),
        "department": getattr(getattr(employee, "department", None), "name", None),
        "permissions": sorted(permissions_of(user)),
        "grants": sorted(g.permission for g in user.permission_grants.all()),
        # The screen greys these rather than hiding them: a disabled control
        # that says why teaches the model, and a missing one looks like a bug.
        "is_owner": user.role == User.Role.OWNER,
    }


class TeamView(APIView):
    """Everyone who can sign in, and what they may do."""

    permission_classes = [IsAuthenticated, IsHRAdmin]
    required_permission = Perm.PEOPLE_ADMIN

    def get(self, request, **kwargs):
        users = (
            User.objects.select_related("employee__department")
            .prefetch_related(Prefetch("permission_grants", queryset=PermissionGrant.objects.only("permission", "user_id")))
            .order_by("-role", "first_name", "username")
        )
        return Response({"members": [_member(u) for u in users]})


class TeamCatalogueView(APIView):
    """The roles and permissions that exist, so the browser keeps no copy."""

    permission_classes = [IsAuthenticated, IsHRAdmin]
    required_permission = Perm.PEOPLE_ADMIN

    def get(self, request, **kwargs):
        mine = permissions_of(request.user)
        return Response({
            "roles": [
                {
                    "value": value,
                    "label": User.Role(value).label,
                    # Owner is excluded from appointment by `set_role`; saying
                    # so here means the screen never offers it and then fails.
                    "appointable": value != User.Role.OWNER,
                }
                for value in ROLE_PERMISSIONS
            ],
            "permissions": [
                {
                    "value": p,
                    "grantable": p not in NEVER_GRANTABLE,
                    # You cannot hand out what you do not hold. The screen
                    # disables these rather than letting the request 403.
                    "held_by_you": p in mine,
                }
                for p in sorted(ALL_PERMS)
            ],
        })


class TeamRoleView(APIView):
    """Appoint somebody."""

    permission_classes = [IsAuthenticated, IsHRAdmin]
    required_permission = Perm.PEOPLE_ADMIN

    def post(self, request, user_id, **kwargs):
        target = User.objects.filter(pk=user_id).first()
        if target is None:
            return Response({"detail": "No such user."}, status=status.HTTP_404_NOT_FOUND)
        role = (request.data or {}).get("role")
        try:
            set_role(request.user, target, role)
        except PermissionError_ as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        target.refresh_from_db()
        return Response(_member(target))


class TeamGrantView(APIView):
    """Give or take back a single capability."""

    permission_classes = [IsAuthenticated, IsHRAdmin]
    required_permission = Perm.PEOPLE_ADMIN

    def post(self, request, user_id, **kwargs):
        return self._change(request, user_id, grant, (request.data or {}).get("permission"))

    def delete(self, request, user_id, **kwargs):
        permission = request.query_params.get("permission") or (request.data or {}).get("permission")
        return self._change(request, user_id, revoke, permission)

    def _change(self, request, user_id, action, permission):
        target = User.objects.filter(pk=user_id).first()
        if target is None:
            return Response({"detail": "No such user."}, status=status.HTTP_404_NOT_FOUND)
        try:
            action(request.user, target, permission)
        except PermissionError_ as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        target.refresh_from_db()
        return Response(_member(target))
