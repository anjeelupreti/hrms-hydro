"""Shared seeding helpers.

Extracted because `quickstart_local` and `seed_everything` each created the
demo login accounts their own way, and both made the same mistake.
"""

from datetime import date, timedelta

from employees.models import Department, Designation, Employee


def ensure_employee_profile(user, *, title, department_name, joined_days_ago=900):
    """Give a login account a real `Employee` record, idempotently.

    **Why this exists.** `quickstart_local` and `seed_everything` both created
    the demo `hr` and `employee` users as bare `User` rows with no `Employee`
    attached. Every account a person actually signs in with was therefore not
    an employee of the company they were administering.

    The visible symptom was `/profile` answering "Profile Not Found", but the
    blast radius was much wider and entirely silent: `me.employee_id` is null,
    so the dashboard's whole **My Day** section, the clock-in widget, personal
    attendance and leave balances all render nothing at all — no error, no
    empty state, just absent. The product looked thinner than it is, through
    the only accounts anyone ever demos it with.

    HR staff *are* employees of the company in any real deployment — they have
    a manager, a leave balance and a payslip like everyone else — so attaching
    the record is the correct model, not a workaround for the empty page.
    """
    existing = Employee.objects.filter(user=user).first()
    if existing is not None:
        return existing

    department, _ = Department.objects.get_or_create(
        name=department_name,
        defaults={"code": department_name[:3].upper(), "description": f"{department_name} team"},
    )
    designation, _ = Designation.objects.get_or_create(
        title=title, defaults={"department": department}
    )

    # Codes are unique, and a company seeded by one command then topped up by
    # another must not collide. Walk past whatever is already taken.
    next_num = Employee.objects.count() + 1
    while Employee.objects.filter(employee_code=f"EMP-{next_num:04d}").exists():
        next_num += 1

    return Employee.objects.create(
        user=user,
        employee_code=f"EMP-{next_num:04d}",
        department=department,
        designation=designation,
        phone="+977-9800000000",
        city="Kathmandu",
        country="Nepal",
        date_of_birth=date(1990, 6, 15),
        date_joined=date.today() - timedelta(days=joined_days_ago),
        bio=f"{title} in the {department_name} team.",
        skills=["People operations", "Compliance"],
        employment_status=Employee.EmploymentStatus.ACTIVE,
    )
