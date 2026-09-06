"""The correspondence register — the chalani and darta books.

**Two registers, and the outgoing one also does the posting.** What the office
did in three acts — write the letter, post it, write it in the book — becomes
one, and the book is then searchable.

The register entry is the durable thing and the email is an attempt: these hold
that a letter is never lost because a mail server was down.
"""

import base64

import pytest
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.utils import timezone
from rest_framework.test import APIClient

from employees.models import Employee
from mail.models import IncomingLetter, OutgoingLetter

pytestmark = pytest.mark.django_db

OUT = "/api/v1/mail/outgoing/"
IN = "/api/v1/mail/incoming/"

PDF = base64.b64decode("JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoKPDwvTGVuZ3RoIDM+PnN0cmVhbQphYmMKZW5kc3RyZWFtCmVuZG9iago=")


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def clerk(db, company, hr_user):
    return Employee.objects.create(
        user=hr_user, employee_code="REG-1",
        date_joined=timezone.now().date(), primary_company=company,
    )


@pytest.fixture
def reader(db, company, employee_user):
    return Employee.objects.create(
        user=employee_user, employee_code="REG-2",
        date_joined=timezone.now().date(), primary_company=company,
    )


def _letter(client, company, **overrides):
    payload = {
        "ref": "OUT-0001",
        "company": company.pk,
        "letter_date": timezone.now().date().isoformat(),
        "subject": "Request for road access permit",
        "addressed_to": "District Administration Office, Rasuwa",
        "recipients": ["dao.rasuwa@example.gov.np"],
        **overrides,
    }
    return client.post(OUT, payload, format="json")


# ── The outgoing register ────────────────────────────────────────────────


def test_a_letter_is_recorded_before_anything_is_sent(clerk, company):
    """Saving records it; sending is a separate act. Attachments need a row to
    belong to, and a letter going by hand should be in the register without
    anybody pretending an email was tried."""
    response = _letter(_client(clerk.user), company)

    assert response.status_code == 201, response.data
    assert response.data["status"] == "draft"
    assert response.data["sent_at"] is None


def test_two_letters_cannot_share_a_reference(clerk, company):
    """The office keeps its own numbering; what a register cannot tolerate is
    two letters under one number."""
    client = _client(clerk.user)
    _letter(client, company)

    again = _letter(client, company)

    assert again.status_code == 400, again.data


def test_the_same_reference_is_free_in_another_company(clerk, company, second_company):
    client = _client(clerk.user)
    _letter(client, company)

    other = _letter(client, second_company)

    assert other.status_code == 201, other.data


def test_a_recipient_has_to_be_an_email_address(clerk, company):
    """A register that accepted "ram sharma" would look like it had sent
    something to a person and have posted nothing at all."""
    response = _letter(_client(clerk.user), company, recipients=["ram sharma"])

    assert response.status_code == 400, response.data
    assert "not an email address" in str(response.data)


def test_sending_records_that_it_went(clerk, company, mailoutbox):
    client = _client(clerk.user)
    letter_id = _letter(client, company).data["id"]

    response = client.post(f"{OUT}{letter_id}/send/", {}, format="json")

    assert response.status_code == 200, response.data
    assert response.data["status"] == "sent"
    assert response.data["sent_at"] is not None
    assert len(mailoutbox) == 1
    assert "OUT-0001" in mailoutbox[0].subject


def test_a_letter_with_nobody_to_email_is_recorded_not_failed(clerk, company, mailoutbox):
    """Plenty are hand-delivered, and the register should hold them without
    pretending an email was tried."""
    client = _client(clerk.user)
    letter_id = _letter(client, company, recipients=[]).data["id"]

    response = client.post(f"{OUT}{letter_id}/send/", {}, format="json")

    assert response.data["status"] == "not_emailed"
    assert response.data["error"] == ""
    assert len(mailoutbox) == 0


def test_a_failed_send_keeps_the_letter_and_says_why(clerk, company, settings, monkeypatch):
    """**The register entry is the durable thing; the email is an attempt.**
    A registry that quietly loses letters is worse than a paper one."""
    client = _client(clerk.user)
    letter_id = _letter(client, company).data["id"]

    def explode(*args, **kwargs):
        raise OSError("Connection refused")

    monkeypatch.setattr("core.email.EmailMultiAlternatives.send", explode)

    response = client.post(f"{OUT}{letter_id}/send/", {}, format="json")

    assert response.status_code == 200, response.data
    assert response.data["status"] == "failed"
    assert "Connection refused" in response.data["error"]
    # And it is still there, ready to be sent again.
    assert OutgoingLetter.objects.filter(pk=letter_id).exists()


def test_a_failed_letter_can_be_sent_again(clerk, company, mailoutbox, monkeypatch):
    client = _client(clerk.user)
    letter_id = _letter(client, company).data["id"]

    def explode(*args, **kwargs):
        raise OSError("Connection refused")

    monkeypatch.setattr("core.email.EmailMultiAlternatives.send", explode)
    client.post(f"{OUT}{letter_id}/send/", {}, format="json")
    monkeypatch.undo()

    response = client.post(f"{OUT}{letter_id}/send/", {}, format="json")

    assert response.data["status"] == "sent"
    assert response.data["error"] == ""


def test_attachments_go_out_with_the_letter(clerk, company, mailoutbox):
    client = _client(clerk.user)
    letter_id = _letter(client, company).data["id"]
    client.post(
        f"{OUT}{letter_id}/attachments/",
        {"file": ContentFile(PDF, name="permit-request.pdf")},
        format="multipart",
    )

    client.post(f"{OUT}{letter_id}/send/", {}, format="json")

    assert len(mailoutbox) == 1
    assert [name for name, _content, _mime in mailoutbox[0].attachments] == ["permit-request.pdf"]


def test_the_covering_note_is_the_offices_own_wording(clerk, company, mailoutbox):
    """The same mechanism the birthday and festival messages use: they own the
    wording, we own when it fires."""
    from notifications.models import ReminderRule

    ReminderRule.objects.create(
        kind="outgoing_letter",
        subject="Patra {ref}",
        body="Sandarbha {ref} miti {date}.",
    )
    client = _client(clerk.user)
    letter_id = _letter(client, company).data["id"]

    client.post(f"{OUT}{letter_id}/send/", {}, format="json")

    assert mailoutbox[0].subject == "Patra OUT-0001"
    assert "Sandarbha OUT-0001" in mailoutbox[0].body


def test_a_stray_brace_in_the_wording_does_not_break_the_send(clerk, company, mailoutbox):
    """`str.format` raises on an unknown key, which would turn a typo in
    somebody's template into a letter that cannot be sent."""
    from notifications.models import ReminderRule

    ReminderRule.objects.create(kind="outgoing_letter", subject="{ref} {oops}", body="{nonsense}")
    client = _client(clerk.user)
    letter_id = _letter(client, company).data["id"]

    response = client.post(f"{OUT}{letter_id}/send/", {}, format="json")

    assert response.data["status"] == "sent"
    assert "OUT-0001" in mailoutbox[0].subject


def test_the_next_reference_is_suggested_not_reserved(clerk, company):
    client = _client(clerk.user)
    _letter(client, company, ref="OUT-0007")

    suggestion = client.get(f"{OUT}next-ref/?company={company.pk}").data["suggestion"]

    assert suggestion == "OUT-0008"


# ── The incoming register ────────────────────────────────────────────────


def _incoming(client, company, **overrides):
    payload = {
        "ref": "IN-0001",
        "company": company.pk,
        "received_on": timezone.now().date().isoformat(),
        "subject": "Permit granted",
        "from_office": "District Administration Office, Rasuwa",
        "received_via": "post",
        **overrides,
    }
    return client.post(IN, payload, format="json")


def test_an_incoming_letter_is_entered_by_hand(clerk, company):
    """Nothing is synced: letters arrive by post, by hand and into half a dozen
    personal mailboxes."""
    response = _incoming(_client(clerk.user), company)

    assert response.status_code == 201, response.data
    assert response.data["from_office"] == "District Administration Office, Rasuwa"


def test_the_people_named_are_told(clerk, company, reader):
    """The point of registering a letter is that it reaches somebody."""
    from notifications.models import Notification

    _incoming(_client(clerk.user), company, notify=[reader.pk])

    assert Notification.objects.filter(recipient=reader.user, verb="letter_received").exists()


def test_fixing_a_typo_does_not_notify_everybody_again(clerk, company, reader):
    """Re-notifying because somebody corrected a subject line is how a
    notification stops being read."""
    from notifications.models import Notification

    client = _client(clerk.user)
    letter_id = _incoming(client, company, notify=[reader.pk]).data["id"]
    assert Notification.objects.filter(recipient=reader.user).count() == 1

    client.patch(f"{IN}{letter_id}/", {"subject": "Permit granted (corrected)"}, format="json")

    assert Notification.objects.filter(recipient=reader.user).count() == 1


def test_the_letter_date_and_the_arrival_date_are_different_facts(clerk, company):
    """A letter dated the 3rd that reached the office on the 11th is eight days
    of somebody else's delay."""
    response = _incoming(
        _client(clerk.user), company,
        letter_date="2026-09-03", received_on="2026-09-11",
    )

    assert response.data["letter_date"] == "2026-09-03"
    assert response.data["received_on"] == "2026-09-11"


def test_a_reply_can_be_tied_to_the_letter_it_answers(clerk, company):
    """Registers track the thread."""
    client = _client(clerk.user)
    sent = _letter(client, company).data["id"]

    reply = _incoming(client, company, in_reply_to=sent)

    assert reply.status_code == 201, reply.data
    assert reply.data["in_reply_to_ref"] == "OUT-0001"
    assert client.get(f"{OUT}{sent}/").data["reply_count"] == 1


def test_the_register_is_searchable_by_who_it_came_from(clerk, company):
    client = _client(clerk.user)
    _incoming(client, company)
    _incoming(client, company, ref="IN-0002", from_office="Nepal Electricity Authority")

    found = client.get(f"{IN}?search=Electricity").data

    assert found["count"] == 1
    assert found["results"][0]["ref"] == "IN-0002"
