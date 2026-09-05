"""Meetings: the agenda, the register, and consenting to what was decided.

**A meeting is a calendar entry plus everything it produces.** `CompanyEvent`
stays the row on the calendar and `MeetingAttendee` stays the invitation; what
these cover is the rest — an agenda that can be changed at any point, a
register of who actually came, and decisions people put their name to or
disagree with in writing.
"""

import base64
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.utils import timezone
from rest_framework.test import APIClient

from employees.models import Employee, Signature
from notifications.models import CompanyEvent, DecisionPosition, MeetingAttendee

pytestmark = pytest.mark.django_db

LIST = "/api/v1/notifications/meetings/"

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _person(username, code, company):
    User = get_user_model()
    user = User.objects.create_user(username=username, email=f"{username}@x.test", password="x")
    return Employee.objects.create(
        user=user, employee_code=code, date_joined=timezone.now().date(), primary_company=company
    )


def _approved_signature(employee):
    row = Signature.objects.create(employee=employee, status=Signature.Status.APPROVED)
    row.image.save("sig.png", ContentFile(PNG), save=True)
    return row


@pytest.fixture
def organiser(db, company, hr_user):
    return Employee.objects.create(
        user=hr_user, employee_code="MTG-ORG",
        date_joined=timezone.now().date(), primary_company=company,
    )


@pytest.fixture
def cast(db, company):
    return {
        "came": _person("m_came", "MTG-1", company),
        "missed": _person("m_missed", "MTG-2", company),
    }


@pytest.fixture
def meeting(db, organiser, cast):
    started = timezone.now() - timedelta(hours=3)
    event = CompanyEvent.objects.create(
        title="Monthly site review",
        event_type=CompanyEvent.EventType.MEETING,
        start_datetime=started,
        end_datetime=started + timedelta(hours=1),
        created_by=organiser.user,
        updated_by=organiser.user,
    )
    for person in cast.values():
        MeetingAttendee.objects.create(event=event, employee=person)
    return event


# ── The agenda ───────────────────────────────────────────────────────────


def test_an_item_can_be_added_after_the_meeting_has_happened(meeting, organiser):
    """**The whole point of the change.** Half an agenda is known a week
    beforehand and the rest arrives in the room; a list that froze when the
    meeting was called would be filled in afterwards by editing the
    description, which is how an agenda stops being a list."""
    response = _client(organiser.user).post(
        f"{LIST}{meeting.pk}/agenda/",
        {"title": "Raised from the floor: access road washout", "raised_in_meeting": True},
        format="json",
    )

    assert response.status_code == 201, response.data
    assert meeting.agenda_items.count() == 1
    assert meeting.agenda_items.first().raised_in_meeting is True


def test_items_are_numbered_in_the_order_they_arrive(meeting, organiser):
    client = _client(organiser.user)
    for title in ("Minutes of the last meeting", "Budget", "Any other business"):
        client.post(f"{LIST}{meeting.pk}/agenda/", {"title": title}, format="json")

    assert list(meeting.agenda_items.values_list("order", flat=True)) == [0, 1, 2]


def test_an_item_can_be_edited_and_removed(meeting, organiser):
    """An agenda item nobody discussed should not sit in the minute pretending
    it was."""
    client = _client(organiser.user)
    created = client.post(f"{LIST}{meeting.pk}/agenda/", {"title": "Budget"}, format="json")
    item_id = created.data["id"]

    edited = client.patch(
        f"{LIST}{meeting.pk}/agenda/{item_id}/", {"title": "Budget, FY83"}, format="json"
    )
    assert edited.status_code == 200, edited.data
    assert edited.data["title"] == "Budget, FY83"

    removed = client.delete(f"{LIST}{meeting.pk}/agenda/{item_id}/")
    assert removed.status_code == 204
    assert meeting.agenda_items.count() == 0


def test_only_the_organiser_changes_the_agenda(meeting, cast):
    response = _client(cast["came"].user).post(
        f"{LIST}{meeting.pk}/agenda/", {"title": "My own item"}, format="json"
    )

    assert response.status_code == 403, response.data


# ── The register ─────────────────────────────────────────────────────────


def test_marking_who_came_is_separate_from_who_accepted(meeting, organiser, cast):
    """RSVP is a promise made beforehand; attendance is what happened. The
    minute records the second."""
    MeetingAttendee.objects.filter(event=meeting, employee=cast["missed"]).update(
        rsvp_status=MeetingAttendee.RsvpStatus.ACCEPTED
    )

    response = _client(organiser.user).post(
        f"{LIST}{meeting.pk}/attendance/",
        {"present": [cast["came"].pk], "absent": [cast["missed"].pk]},
        format="json",
    )

    assert response.status_code == 200, response.data
    rows = {a.employee_id: a for a in meeting.attendees.all()}
    assert rows[cast["came"].pk].attendance == MeetingAttendee.Attendance.PRESENT
    assert rows[cast["missed"].pk].attendance == MeetingAttendee.Attendance.ABSENT
    # Accepted and did not come — both facts survive.
    assert rows[cast["missed"].pk].rsvp_status == MeetingAttendee.RsvpStatus.ACCEPTED
    assert rows[cast["came"].pk].attendance_marked_at is not None


def test_unmarked_is_not_absent(meeting, cast):
    """"We did not take the register" and "they did not come" are different
    facts, and a minute that cannot tell them apart is not worth signing."""
    assert all(
        a.attendance == MeetingAttendee.Attendance.UNMARKED for a in meeting.attendees.all()
    )


def test_marking_one_person_does_not_blank_the_others(meeting, organiser, cast):
    client = _client(organiser.user)
    client.post(
        f"{LIST}{meeting.pk}/attendance/",
        {"present": [cast["came"].pk], "absent": [cast["missed"].pk]},
        format="json",
    )
    # A late arrival, marked on its own.
    client.post(
        f"{LIST}{meeting.pk}/attendance/", {"present": [cast["missed"].pk]}, format="json"
    )

    rows = {a.employee_id: a.attendance for a in meeting.attendees.all()}
    assert rows[cast["came"].pk] == MeetingAttendee.Attendance.PRESENT
    assert rows[cast["missed"].pk] == MeetingAttendee.Attendance.PRESENT


def test_somebody_cannot_be_both_present_and_absent(meeting, organiser, cast):
    response = _client(organiser.user).post(
        f"{LIST}{meeting.pk}/attendance/",
        {"present": [cast["came"].pk], "absent": [cast["came"].pk]},
        format="json",
    )

    assert response.status_code == 400, response.data


# ── Decisions, and putting your name to one ──────────────────────────────


def _decision(meeting, organiser, text="That the access road be repaired before the monsoon."):
    return _client(organiser.user).post(
        f"{LIST}{meeting.pk}/decisions/", {"text": text}, format="json"
    )


def test_circulating_asks_everybody_who_was_invited(meeting, organiser, cast):
    """Not only those who came: somebody absent still has a view on a decision
    taken in their name, and recording that they were asked and did not answer
    is worth more than not asking."""
    from notifications.models import Notification

    decision_id = _decision(meeting, organiser).data["id"]

    response = _client(organiser.user).post(
        f"{LIST}{meeting.pk}/decisions/{decision_id}/circulate/", {}, format="json"
    )

    assert response.status_code == 200, response.data
    assert DecisionPosition.objects.filter(decision_id=decision_id).count() == 2
    for person in cast.values():
        assert Notification.objects.filter(
            recipient=person.user, verb="decision_circulated"
        ).exists()


def test_consent_stamps_the_signature(meeting, organiser, cast):
    _approved_signature(cast["came"])
    decision_id = _decision(meeting, organiser).data["id"]
    _client(organiser.user).post(f"{LIST}{meeting.pk}/decisions/{decision_id}/circulate/", {}, format="json")

    response = _client(cast["came"].user).post(
        f"{LIST}{meeting.pk}/decisions/{decision_id}/respond/",
        {"position": "consent"},
        format="json",
    )

    assert response.status_code == 200, response.data
    row = DecisionPosition.objects.get(decision_id=decision_id, employee=cast["came"])
    assert row.position == DecisionPosition.Position.CONSENT
    assert row.signature is not None
    assert row.answered_at is not None


def test_consent_without_an_approved_signature_is_refused(meeting, organiser, cast):
    """Agreeing is signing your name to something. With nothing to stamp there
    is nothing to record."""
    decision_id = _decision(meeting, organiser).data["id"]
    _client(organiser.user).post(f"{LIST}{meeting.pk}/decisions/{decision_id}/circulate/", {}, format="json")

    response = _client(cast["came"].user).post(
        f"{LIST}{meeting.pk}/decisions/{decision_id}/respond/",
        {"position": "consent"},
        format="json",
    )

    assert response.status_code == 400, response.data
    assert "approved signature" in str(response.data).lower()


def test_dissent_must_say_why(meeting, organiser, cast):
    """A dissent that does not say why tells a reader nothing except that
    somebody was unhappy."""
    decision_id = _decision(meeting, organiser).data["id"]
    _client(organiser.user).post(f"{LIST}{meeting.pk}/decisions/{decision_id}/circulate/", {}, format="json")

    refused = _client(cast["came"].user).post(
        f"{LIST}{meeting.pk}/decisions/{decision_id}/respond/",
        {"position": "dissent", "reason": "   "},
        format="json",
    )
    assert refused.status_code == 400, refused.data

    accepted = _client(cast["came"].user).post(
        f"{LIST}{meeting.pk}/decisions/{decision_id}/respond/",
        {"position": "dissent", "reason": "The estimate excludes the culvert."},
        format="json",
    )
    assert accepted.status_code == 200, accepted.data
    row = DecisionPosition.objects.get(decision_id=decision_id, employee=cast["came"])
    assert row.position == DecisionPosition.Position.DISSENT
    assert "culvert" in row.reason
    # And no stamp: a dissent is not signed.
    assert row.signature is None


def test_somebody_who_was_not_asked_cannot_respond(meeting, organiser, company):
    outsider = _person("m_outsider", "MTG-9", company)
    decision_id = _decision(meeting, organiser).data["id"]
    _client(organiser.user).post(f"{LIST}{meeting.pk}/decisions/{decision_id}/circulate/", {}, format="json")

    response = _client(outsider.user).post(
        f"{LIST}{meeting.pk}/decisions/{decision_id}/respond/",
        {"position": "consent"},
        format="json",
    )

    assert response.status_code in (403, 404), response.data


def test_re_circulating_does_not_wipe_answers_already_given(meeting, organiser, cast):
    """Somebody pressing the button twice should not erase a consent."""
    _approved_signature(cast["came"])
    decision_id = _decision(meeting, organiser).data["id"]
    client = _client(organiser.user)
    client.post(f"{LIST}{meeting.pk}/decisions/{decision_id}/circulate/", {}, format="json")
    _client(cast["came"].user).post(
        f"{LIST}{meeting.pk}/decisions/{decision_id}/respond/", {"position": "consent"}, format="json"
    )

    client.post(f"{LIST}{meeting.pk}/decisions/{decision_id}/circulate/", {}, format="json")

    row = DecisionPosition.objects.get(decision_id=decision_id, employee=cast["came"])
    assert row.position == DecisionPosition.Position.CONSENT


def test_the_tally_says_where_a_decision_stands(meeting, organiser, cast):
    """So a reader sees it without doing arithmetic on a list of names."""
    _approved_signature(cast["came"])
    decision_id = _decision(meeting, organiser).data["id"]
    _client(organiser.user).post(f"{LIST}{meeting.pk}/decisions/{decision_id}/circulate/", {}, format="json")
    _client(cast["came"].user).post(
        f"{LIST}{meeting.pk}/decisions/{decision_id}/respond/", {"position": "consent"}, format="json"
    )
    response = _client(cast["missed"].user).post(
        f"{LIST}{meeting.pk}/decisions/{decision_id}/respond/",
        {"position": "dissent", "reason": "Too early in the season."},
        format="json",
    )

    assert response.data["tally"] == {"consent": 1, "dissent": 1, "abstain": 0, "pending": 0}


# ── The minute ───────────────────────────────────────────────────────────


def test_a_minute_is_drafted_from_the_register_and_the_decisions(meeting, organiser, cast):
    """**Why decisions come first.** A minute drafted before them is a summary
    of what somebody remembers; drafted from the agenda and the register it is
    a record of what happened."""
    client = _client(organiser.user)
    client.post(f"{LIST}{meeting.pk}/agenda/", {"title": "Access road washout"}, format="json")
    client.post(
        f"{LIST}{meeting.pk}/attendance/",
        {"present": [cast["came"].pk], "absent": [cast["missed"].pk]},
        format="json",
    )
    _decision(meeting, organiser, text="That the culvert be rebuilt.")

    response = client.post(f"{LIST}{meeting.pk}/minutes/", {}, format="json")

    assert response.status_code == 201, response.data
    body = response.data["content"]
    assert "Access road washout" in body
    assert "That the culvert be rebuilt." in body
    assert "Present:" in body and "Apologies:" in body
    # The consent table is left for the page to draw — it needs the signature
    # images, which are files rather than text.
    assert 'data-minutes-consent-table="1"' in body


def test_the_register_says_when_it_was_not_taken(meeting, organiser):
    """A minute should not imply a register was taken when it was not."""
    response = _client(organiser.user).post(f"{LIST}{meeting.pk}/minutes/", {}, format="json")

    assert "Not recorded:" in response.data["content"]


def test_drafting_twice_does_not_throw_away_the_writing(meeting, organiser):
    client = _client(organiser.user)
    client.post(f"{LIST}{meeting.pk}/minutes/", {}, format="json")
    client.patch(
        f"{LIST}{meeting.pk}/minutes/", {"content": "<p>Written by hand.</p>"}, format="json"
    )

    again = client.post(f"{LIST}{meeting.pk}/minutes/", {}, format="json")

    assert again.status_code == 200
    assert "Written by hand." in again.data["content"]


def test_a_final_minute_cannot_be_edited(meeting, organiser):
    """Final is evidence, like a decided memorandum."""
    client = _client(organiser.user)
    client.post(f"{LIST}{meeting.pk}/minutes/", {}, format="json")
    finalised = client.post(f"{LIST}{meeting.pk}/minutes/finalise/", {}, format="json")
    assert finalised.status_code == 200, finalised.data
    assert finalised.data["is_locked"] is True

    response = client.patch(
        f"{LIST}{meeting.pk}/minutes/", {"content": "<p>After the fact.</p>"}, format="json"
    )

    assert response.status_code == 400, response.data


def test_finalising_tells_everybody_who_was_invited(meeting, organiser, cast):
    from notifications.models import Notification

    client = _client(organiser.user)
    client.post(f"{LIST}{meeting.pk}/minutes/", {}, format="json")
    client.post(f"{LIST}{meeting.pk}/minutes/finalise/", {}, format="json")

    for person in cast.values():
        assert Notification.objects.filter(recipient=person.user, verb="minutes_final").exists()


def test_the_minute_content_is_sanitised(meeting, organiser):
    """Same allow-list as a memorandum — it is rendered into other people's
    pages and printed."""
    client = _client(organiser.user)
    client.post(f"{LIST}{meeting.pk}/minutes/", {}, format="json")

    response = client.patch(
        f"{LIST}{meeting.pk}/minutes/",
        {"content": "<p>Fine.</p><script>steal()</script>"},
        format="json",
    )

    assert response.status_code == 200, response.data
    assert "<script" not in response.data["content"]
    assert "Fine." in response.data["content"]


def test_the_template_is_configurable_and_the_draft_follows_it(meeting, organiser):
    """The headings are data, because every office writes minutes to its own
    form. Changing the template changes what a draft comes out as."""
    from notifications.models import MinutesSection, MinutesTemplate
    from notifications.services import default_minutes_template

    default_minutes_template()  # create it
    template = MinutesTemplate.objects.get(is_default=True)
    template.sections.all().delete()
    MinutesSection.objects.create(
        template=template, order=0, heading="Upasthiti", source="attendance"
    )
    MinutesSection.objects.create(
        template=template, order=1, heading="Nirnaya", source="decisions"
    )

    response = _client(organiser.user).post(f"{LIST}{meeting.pk}/minutes/", {}, format="json")

    body = response.data["content"]
    assert "<h3>Upasthiti</h3>" in body
    assert "<h3>Nirnaya</h3>" in body
    assert "Agenda" not in body
