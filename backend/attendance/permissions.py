from django.utils import timezone
from rest_framework.permissions import SAFE_METHODS, BasePermission

from accounts.policy import Perm, can
from employees.models import Employee


def _requesting_employee(user):
    try:
        return user.employee
    except Employee.DoesNotExist:
        return None


def _amendable_for_a_trip(user, log):
    """May this past attendance row be corrected because of a trip?

    Four things have to hold at once, and each is doing work:

    * The person asking manages attendance. This is a correction made *for*
      somebody, not one they make for themselves.
    * The day is in the current month. Payroll runs monthly, so a paid month is
      closed; an unbounded window would let last quarter be rewritten.
    * An approved visit covers the day. The approval is somebody else agreeing
      the person was away — without it this is a back-dated edit wearing a
      better name.
    * It is that employee's own visit. Somebody else's trip says nothing about
      where this person was.

    Imported inside the function because `fieldvisits` imports `attendance`
    for its roster helpers; at module scope this is a cycle.
    """
    from accounts.policy import Perm, can

    if not can(user, Perm.ATTENDANCE_MANAGE):
        return False

    today = timezone.localdate()
    if (log.date.year, log.date.month) != (today.year, today.month):
        return False

    from fieldvisits.models import FieldVisit

    return FieldVisit.objects.filter(
        employee_id=log.employee_id,
        status__in=[FieldVisit.Status.APPROVED, FieldVisit.Status.COMPLETED],
        starts_on__lte=log.date,
        ends_on__gte=log.date,
    ).exists()


class AttendanceLogPermission(BasePermission):
    """HR admins/superusers: full access to everyone's attendance.
    Managers: read-only access to their direct reports' attendance.
    Everyone else: read/write access to their own attendance only.

    Writes are locked to *today's* record for everybody, including HR —
    attendance is not meant to be retroactively rewritten and yesterday's
    record is history once the day is over. Checked ahead of the role logic so
    no role can bypass it.

    **One exception, and a narrow one: a day covered by an approved field visit
    or travel order, within the current month.** A trip is written up after the
    fact all the time — an emergency call-out at 2am is recorded the next
    morning, a week at the headworks is filed on the Monday after — and the
    attendance for those days cannot be corrected under a same-day rule. The
    person was demonstrably not absent; the record says they were. See
    `_amendable_for_a_trip`.
    """

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if request.method not in SAFE_METHODS and obj.date != timezone.localdate():
            if not _amendable_for_a_trip(request.user, obj):
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
