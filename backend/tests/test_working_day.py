"""How long a paid day actually is.

The fulfilment dial needs a denominator, and the obvious one is wrong: the
office *span* is not the working day. Nine-to-six with an hour for lunch is
eight paid hours, and a dial reporting nine tells somebody they are nearly done
when they finished an hour ago.
"""

from datetime import date, time, timedelta

import pytest
from django.utils import timezone

from attendance.models import Shift, ShiftAssignment
from attendance.punches import working_day_seconds
from employees.models import Employee
from organization.models import CompanyProfile

pytestmark = pytest.mark.django_db


@pytest.fixture
def person(company, admin_user):
    yield Employee.objects.create(
        user=admin_user, employee_code="EMP-DAY", date_joined=date(2020, 1, 1)
    )


def test_the_unpaid_break_comes_off_the_span(company, person):
    """09:00–18:00 is nine hours of being present and eight of being paid."""
    company = CompanyProfile.get_solo()
    company.office_start_time = time(9, 0)
    company.office_end_time = time(18, 0)
    company.unpaid_break_minutes = 60
    company.save()

    assert working_day_seconds(person) == 8 * 3600


def test_a_shift_beats_the_company_hours(company, person):
    """Somebody on a shift is measured against *their* day. A company-wide
    number cannot be right for a factory shift and an office one at once."""
    company = CompanyProfile.get_solo()
    company.office_start_time = time(9, 0)
    company.office_end_time = time(18, 0)
    company.unpaid_break_minutes = 60
    company.save()

    shift = Shift.objects.create(name="Early", start_time=time(6, 0), end_time=time(14, 0))
    ShiftAssignment.objects.create(
        employee=person, shift=shift, start_date=timezone.localdate() - timedelta(days=1)
    )

    # Eight hours of span, less the company's hour — the shift sets no
    # break of its own.
    assert working_day_seconds(person) == 7 * 3600


def test_a_shift_can_set_its_own_break_including_none(company, person):
    """🔒 Null means "use the company's"; zero means "this shift has none".

    Those are different statements, and collapsing them would silently give
    every break-free shift an hour it does not take.
    """
    company = CompanyProfile.get_solo()
    company.unpaid_break_minutes = 60
    company.office_start_time = time(9, 0)
    company.office_end_time = time(18, 0)
    company.save()

    shift = Shift.objects.create(
        name="Straight through",
        start_time=time(8, 0),
        end_time=time(14, 0),
        unpaid_break_minutes=0,
    )
    ShiftAssignment.objects.create(
        employee=person, shift=shift, start_date=timezone.localdate() - timedelta(days=1)
    )

    assert working_day_seconds(person) == 6 * 3600


def test_a_night_shift_crossing_midnight_is_not_negative(company, person):
    """22:00–06:00 ends before it starts on the clock. Subtracting naively
    gives minus sixteen hours, and a dial would run backwards."""
    shift = Shift.objects.create(
        name="Night",
        start_time=time(22, 0),
        end_time=time(6, 0),
        unpaid_break_minutes=30,
        is_night_shift=True,
    )
    ShiftAssignment.objects.create(
        employee=person, shift=shift, start_date=timezone.localdate() - timedelta(days=1)
    )

    assert working_day_seconds(person) == 8 * 3600 - 30 * 60


def test_no_hours_set_reports_nothing_rather_than_guessing(company, person):
    """`office_start_time` is nullable by design. A dial that filled in 9-to-5
    on its own would be inventing its own denominator."""
    company = CompanyProfile.get_solo()
    company.office_start_time = None
    company.office_end_time = None
    company.save()

    assert working_day_seconds(person) is None


def test_a_break_longer_than_the_span_reports_nothing(company, person):
    """Nonsense configuration must not produce a zero or negative target — a
    dial divided by nought is not a dial."""
    company = CompanyProfile.get_solo()
    company.office_start_time = time(9, 0)
    company.office_end_time = time(10, 0)
    company.unpaid_break_minutes = 120
    company.save()

    assert working_day_seconds(person) is None
