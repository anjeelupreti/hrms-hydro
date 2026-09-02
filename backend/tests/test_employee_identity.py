"""The identity half of an employee record: who they legally are, on file.

**These fields were readable everywhere and writable nowhere.** The model holds
`citizenship_front`/`citizenship_back` and the four statutory numbers, the
employment record renders them, the person's own profile renders them — and no
form in the product ever set one, so every record in the company read "Not on
file" because every record genuinely was. The write serializer was widened for
this in earlier work and the form was never built, which is a fix that lands
one layer short of the screen and looks identical to a fix that worked.

So the tests here go **through the API**, not through the serializer. A
serializer test would have passed throughout the entire period nothing could
reach it.
"""

import base64
from datetime import date

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from employees.models import Employee

pytestmark = pytest.mark.django_db

URL = "/api/v1/employees/employees/"

#: A 1×1 PNG. `ImageField` runs Pillow over the upload, so a text file named
#: `.png` is rejected — the bytes have to be a real image.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


@pytest.fixture
def person(company, employee_user):
    yield Employee.objects.create(
        user=employee_user,
        employee_code="EMP-900",
        date_joined=date(2026, 1, 1),
    )


def test_a_person_with_no_date_of_birth_can_be_saved(company, hr_client, person):
    """🔒 An untouched date arrives from the form as `""`.

    DRF's `DateField` rejects that outright, so the save died on "Date has wrong
    format. Use one of these formats instead: YYYY-MM-DD" — naming a field
    nobody had typed in. The model marks all three of these `null=True`:
    optional there and mandatory here is not a stricter API, it is a
    contradiction, and it made a birthday a condition of hiring somebody.
    """
    response = hr_client.patch(
        f"{URL}{person.id}/",
        {"date_of_birth": "", "passport_expiry": "", "probation_end_date": "", "phone": "9800000000"},
        format="json",
    )
    assert response.status_code == 200, response.data

    person.refresh_from_db()
    assert person.date_of_birth is None
    assert person.phone == "9800000000"


def test_a_blank_date_does_not_erase_a_real_one_by_accident(company, hr_client, person):
    """Blank means "not recorded", and the normalisation writes `None` — so a
    form that posts an empty box over a date somebody had entered *does* clear
    it. That is the intended reading of an emptied field, and it is worth
    pinning: the alternative (ignore blanks) would make a date impossible to
    remove once set."""
    person.date_of_birth = date(1995, 7, 2)
    person.save(update_fields=["date_of_birth"])

    response = hr_client.patch(f"{URL}{person.id}/", {"date_of_birth": ""}, format="json")
    assert response.status_code == 200, response.data

    person.refresh_from_db()
    assert person.date_of_birth is None


def test_the_citizenship_scans_can_actually_be_uploaded(company, hr_client, person):
    """🔒 The defect the owner reported, in one assertion.

    Two screens displayed these and nothing wrote them. A multipart PATCH is
    what the form sends; if the write serializer ever stops declaring them, DRF
    answers 200 and drops the value silently, so asserting on the response
    status alone would keep passing.
    """
    response = hr_client.patch(
        f"{URL}{person.id}/",
        {
            "citizenship_front": SimpleUploadedFile("front.png", PNG, content_type="image/png"),
            "citizenship_back": SimpleUploadedFile("back.png", PNG, content_type="image/png"),
        },
        format="multipart",
    )
    assert response.status_code == 200, response.data

    person.refresh_from_db()
    assert person.citizenship_front, "front scan did not stick"
    assert person.citizenship_back, "back scan did not stick"


def test_the_statutory_numbers_can_be_entered(company, hr_client, person):
    """PAN and SSF are what payroll files against. They were in the same state
    as the scans: on the record, on both screens, enterable nowhere."""
    response = hr_client.patch(
        f"{URL}{person.id}/",
        {
            "pan_number": "301234567",
            "ssf_number": "SSF-99881",
            "pf_number": "PF-4410",
            "cit_number": "CIT-7781",
            "legal_first_name": "Sunita",
            "legal_last_name": "Shrestha",
            "citizenship_number": "27-01-70-01234",
            "marital_status": "married",
        },
        format="json",
    )
    assert response.status_code == 200, response.data

    person.refresh_from_db()
    assert person.pan_number == "301234567"
    assert person.ssf_number == "SSF-99881"
    assert person.pf_number == "PF-4410"
    assert person.cit_number == "CIT-7781"
    assert person.legal_first_name == "Sunita"
    assert person.citizenship_number == "27-01-70-01234"
    assert person.marital_status == "married"


def test_a_colleague_cannot_read_somebody_elses_scans(company, employee_client, person, hr_client):
    """Making them writable must not make them readable. The whole sensitive
    group is stripped in `to_representation` for anyone who is neither HR nor
    the person themselves, and a new field added to `fields` without that
    gating publishes every employee's identity documents to every colleague."""
    person.citizenship_front.save("front.png", SimpleUploadedFile("front.png", PNG), save=True)

    from accounts.models import User

    other = User.objects.create_user(username="nosy-colleague", password="x", role="employee")
    Employee.objects.create(user=other, employee_code="EMP-901", date_joined=date(2026, 1, 1))

    from rest_framework.test import APIClient

    client = APIClient()
    client.force_authenticate(user=other)

    response = client.get(f"{URL}{person.id}/")
    assert response.status_code == 200, response.data
    assert "citizenship_front" not in response.data
    assert "pan_number" not in response.data


def test_a_colleague_cannot_read_a_home_address_or_personal_number(
    employee_client, hr_client, person, company, db
):
    """🔒 The directory publishes correspondence details, not private ones.

    `office_phone` and `office_email` exist to be looked up — that is what a
    staff directory is for. The personal pair and the two addresses arrived
    with the same piece of work and were not added to `SENSITIVE_FIELDS`, so
    every colleague could read every home address off the same payload.
    """
    # Somebody *else* — reading your own record is supposed to show everything.
    from accounts.models import User
    from employees.models import Employee

    colleague = Employee.objects.create(
        user=User.objects.create_user(username="someone.else", password="x"),
        employee_code="EMP-901",
        date_joined=date(2024, 1, 1),
        primary_company=company,
    )

    hr_client.patch(
        f"/api/v1/employees/employees/{colleague.pk}/",
        {
            "office_email": "worker@vlucl.com.np",
            "office_phone": "+977-1-4000000",
            "personal_email": "worker@example.com",
            "personal_phone": "+977-9800000000",
            "permanent_address": "Uttargaya-4, Rasuwa",
            "temporary_address": "Lazimpat, Kathmandu",
            "blood_group": "O+",
        },
        format="json",
    )

    seen = employee_client.get(f"/api/v1/employees/employees/{colleague.pk}/").data
    for private in (
        "personal_email",
        "personal_phone",
        "permanent_address",
        "temporary_address",
    ):
        assert private not in seen, private

    # Correspondence details stay — withholding them would break the directory.
    assert seen["office_email"] == "worker@vlucl.com.np"
    assert seen["office_phone"] == "+977-1-4000000"
    # And the blood group, which is on the ID card for the same reason it is
    # here: the moment it matters is the moment nobody can ask HR.
    assert seen["blood_group"] == "O+"

    # HR still sees everything.
    full = hr_client.get(f"/api/v1/employees/employees/{colleague.pk}/").data
    assert full["personal_email"] == "worker@example.com"
    assert full["permanent_address"] == "Uttargaya-4, Rasuwa"
