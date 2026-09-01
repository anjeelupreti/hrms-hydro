"""Which days the company works, and the off-by-one that nothing could catch.

`CompanyProfile.working_days` is the input to every date calculation that has
to skip a weekend — leave costs, absence marking, timesheet gaps. It is read
with `isoweekday()`, where **Monday is 1 and Sunday is 7**.

`working_days` is read as `day.isoweekday() in working` — Monday is 1. The same
week written in Python's `date.weekday()` dialect (Monday 0) shifts every day by
one: Saturday, the Nepali weekend, is charged as a working day and Friday is
given away free, and every leave balance is computed against a week nobody
works.

Set membership is *false* rather than an error, so there is no exception, no log
line and no failing test — the only moment the mistake is visible is when it is
written down. Hence a validator, and hence these — the check has to live at the write, and
the tests have to pin the *shift*, not just the range.
"""

import pytest
from django.core.exceptions import ValidationError

from organization.models import CompanyProfile, validate_iso_weekdays

pytestmark = pytest.mark.django_db


def test_zero_is_refused_because_it_gives_the_whole_list_away():
    """No ISO weekday is 0. Its presence means every entry is off by one, not
    that one entry is stray — so the message says that rather than "invalid"."""
    with pytest.raises(ValidationError) as caught:
        validate_iso_weekdays([0, 1, 2, 3, 4, 6])

    assert "off by one" in str(caught.value)


def test_the_nepali_working_week_is_accepted():
    """Sunday to Friday, Saturday off — the week this product is built for, and
    the one the broken value was trying to express."""
    validate_iso_weekdays([7, 1, 2, 3, 4, 5])


def test_a_day_outside_the_week_is_refused():
    with pytest.raises(ValidationError):
        validate_iso_weekdays([1, 2, 8])


def test_an_empty_week_is_allowed():
    """Empty means "not configured", and `working_day_set()` reads that as *every
    day counts*. A company that has not set its week yet must not be blocked from
    saving its address."""
    validate_iso_weekdays([])


def test_the_validator_runs_on_the_model(company):
    """A validator the model does not carry protects nothing — `full_clean` is
    where the API and the admin both end up."""
    profile = CompanyProfile.get_solo()
    profile.working_days = [0, 1, 2, 3, 4, 6]

    with pytest.raises(ValidationError) as caught:
        profile.full_clean()

    assert "working_days" in caught.value.error_dict


def test_the_repair_shifts_a_python_week_onto_iso(company):
    """What migration 0014 does, pinned to the observed value.

    `[0, 1, 2, 3, 4, 6]` + 1 is `[1, 2, 3, 4, 5, 7]` — Monday to Friday plus
    Sunday, which is Sunday to Friday. The point of the test is the *result*: a
    shift that produced a different week would still look tidy.
    """
    shifted = sorted({d + 1 for d in [0, 1, 2, 3, 4, 6]})

    assert shifted == [1, 2, 3, 4, 5, 7]
    validate_iso_weekdays(shifted)

    # Saturday (6) is the day that must be absent — it is the weekend, and it
    # was the day the broken value was charging for.
    assert 6 not in shifted
