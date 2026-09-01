"""One definition of "which employees may this user see".

The rule — yourself, plus anyone reporting to you, unless you are HR — was
written out by hand in five places (`attendance`, `dashboard`, `employees`,
`leave` twice). Five copies of one access rule is five chances to drift, and
they already had: `dashboard` omitted the `employee is None` guard, so a user
with no employee profile hit
`Q(employee=None) | Q(employee__manager=None)`, which compiles to
`employee_id IS NULL OR manager_id IS NULL` — no rows for the first branch,
and **every unmanaged employee's rows** for the second.

Keeping it here also makes the coming hierarchy change (an ancestor walk
instead of a direct-manager check) a one-line edit rather than five.
"""

from django.db.models import Q

from accounts.policy import Perm, can
from employees.models import Employee


def requesting_employee(user):
    """The Employee profile behind a User, or None.

    A User without one is normal, not an error — platform-created admins and
    service accounts exist before (or without) an employee record.
    """
    try:
        return user.employee
    except Employee.DoesNotExist:
        return None


def is_people_admin(user) -> bool:
    """HR admins and superusers see everyone. Kept as its own predicate so
    the two role checks never drift apart either."""
    return can(user, Perm.PEOPLE_MANAGE)


def visible_employee_q(employee, path: str = "employee") -> Q:
    """`Q` matching rows for `employee` or their direct reports.

    `path` is the lookup prefix to the Employee FK on the model being
    filtered — every current caller uses the default.
    """
    return Q(**{path: employee}) | Q(**{f"{path}__manager": employee})


def scope_to_visible(queryset, user, path: str = "employee"):
    """Narrow `queryset` to what `user` is allowed to see.

    Fails closed: a user with no employee profile and no HR role gets
    nothing, rather than falling through to a filter that happens to match
    unmanaged rows.
    """
    if is_people_admin(user):
        return queryset

    employee = requesting_employee(user)
    if employee is None:
        return queryset.none()

    return queryset.filter(visible_employee_q(employee, path))
