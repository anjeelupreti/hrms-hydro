"""Filing away what is finished.

Archiving answers a different question from deactivating, and the codebase now
has both. `is_active` retires a **definition** — a leave type nobody should pick
again. `archived_at` files away a **record that is over**: a completed
onboarding checklist, last festival's announcement, a survey that closed in
March. Neither is inactive, wrong, or deletable; they are simply not today's
business.

The bug these exist to prevent is the one found while building it: hiding
archived rows in `filter_queryset` also hid them from `get_object()`, so
**restoring something answered 404** — the one row the action exists to reach
was the one row it could not see. An archive test that only archives passes
happily through that.
"""

import pytest

from notifications.models import Announcement

pytestmark = [pytest.mark.django_db]

BASE = "/api/v1/notifications/announcements"


@pytest.fixture
def notice(company):
    yield Announcement.objects.create(title="Monsoon readiness", body="Check the gates.")


def test_archiving_takes_it_out_of_the_list(hr_client, company, notice):
    assert hr_client.get(f"{BASE}/").data["count"] == 1

    response = hr_client.post(f"{BASE}/{notice.pk}/archive/")
    assert response.status_code == 200

    assert hr_client.get(f"{BASE}/").data["count"] == 0
    assert hr_client.get(f"{BASE}/?archived=1").data["count"] == 1


def test_it_can_be_brought_back(hr_client, company, notice):
    """`get_object()` runs the detail lookup through the same filter, so the
    archive filter must apply to the list alone or restoring cannot reach the
    row it exists for."""
    hr_client.post(f"{BASE}/{notice.pk}/archive/")

    response = hr_client.post(f"{BASE}/{notice.pk}/unarchive/")
    assert response.status_code == 200, "restoring must reach a row the list hides"

    assert hr_client.get(f"{BASE}/").data["count"] == 1
    assert hr_client.get(f"{BASE}/?archived=1").data["count"] == 0


def test_who_archived_it_and_when_are_recorded(hr_client, company, notice, hr_user):
    """"Why is this not in my list?" is answered by a name and a date, and
    cannot be answered by a boolean."""
    hr_client.post(f"{BASE}/{notice.pk}/archive/")

    notice.refresh_from_db()
    assert notice.archived_at is not None
    assert notice.archived_by_id == hr_user.pk
    assert notice.is_archived is True


def test_archiving_twice_changes_nothing(hr_client, company, notice):
    """Idempotent: a double click must not move the timestamp."""
    hr_client.post(f"{BASE}/{notice.pk}/archive/")
    notice.refresh_from_db()
    first = notice.archived_at

    hr_client.post(f"{BASE}/{notice.pk}/archive/")
    notice.refresh_from_db()
    assert notice.archived_at == first


def test_the_archive_is_hidden_but_reachable(hr_client, company, notice):
    """Hidden by default, never silently — otherwise somebody hunts for a row
    that is sitting in the archive."""
    hr_client.post(f"{BASE}/{notice.pk}/archive/")

    assert hr_client.get(f"{BASE}/").data["count"] == 0
    assert hr_client.get(f"{BASE}/?archived=1").data["count"] == 1
    assert hr_client.get(f"{BASE}/?archived=all").data["count"] == 1


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/checklists",
        "/api/v1/surveys",
        "/api/v1/goals/objectives",
        "/api/v1/projects/projects",
        "/api/v1/recruitment/jobs",
        "/api/v1/training/sessions",
    ],
)
def test_every_wired_list_understands_the_archive_filter(hr_client, company, path):
    """One pattern, applied in seven places — so it has to answer the same way
    in all of them rather than only where it was first written."""
    for query in ("", "?archived=1", "?archived=all"):
        response = hr_client.get(f"{path}/{query}")
        assert response.status_code == 200, f"{path}{query} → {response.status_code}"
