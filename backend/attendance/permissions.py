from django.utils import timezone
from rest_framework.permissions import SAFE_METHODS, BasePermission

from accounts.policy import Perm, can
from employees.models import Employee


def _requesting_employee(user):
    try:
        return user.employee
    except Employee.DoesNotExist:
        return None


class AttendanceLogPermission(BasePermission):
    """HR admins/superusers: full access to everyone's attendance.
    Managers: read-only access to their direct reports' attendance.
    Everyone else: read/write access to their own attendance only.

    Writes are additionally locked to *today's* record, for anyone
    including HR — attendance isn't meant to be retroactively rewritten;
    yesterday's record is history once the day is over. This is checked
    ahead of the role logic so it can't be bypassed by any role.
    """

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if request.method not in SAFE_METHODS and obj.date != timezone.localdate():
            return False

        user = request.user
        if can(user, Perm.ATTENDANCE_MANAGE):
            return True

        employee = _requesting_employee(user)
        if employee is None:
            return False

        if obj.employee_id == employee.id:
            return True

        if obj.employee.manager_id == employee.id:
            return request.method in SAFE_METHODS

        return False
