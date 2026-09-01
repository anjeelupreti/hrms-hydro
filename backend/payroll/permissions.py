from rest_framework.permissions import BasePermission

from accounts.policy import Perm, can


class IsHRAdmin(BasePermission):
    """Compensation data is sensitive — unlike most config (leave types,
    holidays), even *read* access to salary components/structures/runs needs a
    capability. Employees only ever see their own finalised/paid payslips, via
    PayslipViewSet's own scoping, never this permission.

    Gates on `payroll.view` rather than `payroll.run`: an officer given sight of
    payroll to answer questions is a real arrangement, and it should not require
    also handing them the ability to pay everybody.
    """

    def has_permission(self, request, view):
        return can(request.user, getattr(view, "required_permission", Perm.PAYROLL_VIEW))
