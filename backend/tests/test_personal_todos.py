"""The personal list is only worth having if it is actually private.

Every other module in this codebase has a permission class that lets an HR admin
or a `settings.manage` holder through, and that is right for employee records,
pay and leave. It is wrong here, and the difference is not enforced by a
permission class — it is enforced by the *absence* of one, which is exactly the
kind of thing a later change "fixes" by adding the usual boilerplate.

So the isolation is pinned by tests, and the intruder in them is an HR admin
rather than a random colleague: the account most likely to be handed a way in.
"""

import pytest

from personal.models import Todo

BASE = "/api/v1/personal/todos"


@pytest.fixture
def todo(company, employee_user):
    return Todo.objects.create(owner=employee_user, title="Ring the bank")


@pytest.mark.django_db
class TestPrivacy:
    def test_hr_admin_cannot_read_my_todo(self, hr_client, todo):
        assert hr_client.get(f"{BASE}/{todo.pk}/").status_code == 404

    def test_hr_admin_cannot_edit_or_delete_my_todo(self, company, hr_client, todo):
        assert (
            hr_client.patch(f"{BASE}/{todo.pk}/", {"title": "hacked"}, format="json").status_code
            == 404
        )
        assert hr_client.delete(f"{BASE}/{todo.pk}/").status_code == 404
        assert Todo.objects.get(pk=todo.pk).title == "Ring the bank"

    def test_list_shows_only_my_own(self, company, employee_client, employee_user, hr_user, todo):
        Todo.objects.create(owner=hr_user, title="Theirs")
        titles = [row["title"] for row in employee_client.get(f"{BASE}/").data["results"]]
        assert titles == ["Ring the bank"]

    def test_owner_cannot_be_set_from_the_request_body(
        self, company, employee_client, employee_user, hr_user
    ):
        """Writing into somebody else's list must not be a matter of asking."""
        response = employee_client.post(
            f"{BASE}/", {"title": "Planted", "owner": hr_user.pk}, format="json"
        )
        assert response.status_code == 201
        assert Todo.objects.get(pk=response.data["id"]).owner_id == employee_user.pk

    def test_anonymous_is_refused(self, api_client):
        assert api_client.get(f"{BASE}/").status_code in (401, 403)


@pytest.mark.django_db
class TestLifecycle:
    def test_new_items_go_to_the_top(self, employee_client):
        for title in ("first", "second", "third"):
            employee_client.post(f"{BASE}/", {"title": title}, format="json")
        titles = [row["title"] for row in employee_client.get(f"{BASE}/").data["results"]]
        assert titles == ["third", "second", "first"]

    def test_order_may_go_negative(self, employee_client):
        """`PositiveIntegerField` made the top-of-list insert a check violation.

        The very first to-do anybody wrote landed at `min(order) - 1`, which
        Postgres rejected outright. This pins the column as signed rather than
        trusting it to stay that way.
        """
        employee_client.post(f"{BASE}/", {"title": "a"}, format="json")
        response = employee_client.post(f"{BASE}/", {"title": "b"}, format="json")
        assert response.status_code == 201
        assert response.data["order"] < 0

    def test_archived_todo_can_be_restored(self, employee_client, todo):
        """`restore` must reach a row the list hides.

        `get_object` goes through `get_queryset` too, so an archive filter
        applied to every action makes an archived row unfetchable by id — and
        archiving becomes the one-way door it was introduced to avoid.
        """
        assert employee_client.post(f"{BASE}/{todo.pk}/archive/").status_code == 200
        assert employee_client.get(f"{BASE}/").data["count"] == 0

        response = employee_client.post(f"{BASE}/{todo.pk}/restore/")
        assert response.status_code == 200
        assert response.data["is_archived"] is False
        assert employee_client.get(f"{BASE}/").data["count"] == 1

    def test_archived_are_listed_separately(self, company, employee_client, employee_user, todo):
        Todo.objects.create(owner=employee_user, title="live")
        employee_client.post(f"{BASE}/{todo.pk}/archive/")
        assert employee_client.get(f"{BASE}/").data["count"] == 1
        assert employee_client.get(f"{BASE}/?archived=1").data["count"] == 1

    def test_toggle_flips_both_ways(self, employee_client, todo):
        assert employee_client.post(f"{BASE}/{todo.pk}/toggle/").data["is_done"] is True
        assert employee_client.post(f"{BASE}/{todo.pk}/toggle/").data["is_done"] is False

    def test_title_is_trimmed_and_blank_is_rejected(self, employee_client):
        created = employee_client.post(f"{BASE}/", {"title": "  spaced  "}, format="json")
        assert created.data["title"] == "spaced"
        assert employee_client.post(f"{BASE}/", {"title": "   "}, format="json").status_code == 400

    def test_reorder_ignores_ids_i_do_not_own(self, company, employee_client, hr_user, todo):
        theirs = Todo.objects.create(owner=hr_user, title="theirs", order=5)

        response = employee_client.post(
            f"{BASE}/reorder/", {"ids": [theirs.pk, todo.pk]}, format="json"
        )
        assert response.data["reordered"] == 1
        theirs.refresh_from_db()
        assert theirs.order == 5, "somebody else's list was rewritten"

    def test_reorder_rejects_a_non_list(self, employee_client):
        assert employee_client.post(f"{BASE}/reorder/", {"ids": "nope"}, format="json").status_code == 400


@pytest.mark.django_db
class TestSavedThread:
    """The notes thread — one member, you."""

    SAVED = "/api/v1/chat/conversations/saved/"

    def test_get_or_create_is_stable(self, employee_client):
        first = employee_client.get(self.SAVED)
        assert first.status_code == 200
        assert first.data["type"] == "self"
        assert first.data["display_name"] == "Your notes"
        assert employee_client.get(self.SAVED).data["id"] == first.data["id"]

    def test_each_person_gets_their_own(self, employee_client, hr_client):
        assert employee_client.get(self.SAVED).data["id"] != hr_client.get(self.SAVED).data["id"]

    def test_nobody_else_sees_my_notes_thread(self, employee_client, hr_client):
        employee_client.get(self.SAVED)  # bring mine into being
        mine = employee_client.get(self.SAVED).data["id"]
        visible = [c["id"] for c in hr_client.get("/api/v1/chat/conversations/").data["results"]]
        assert mine not in visible

    def test_a_note_can_be_posted_to_it(self, employee_client):
        thread = employee_client.get(self.SAVED).data["id"]
        response = employee_client.post(
            f"/api/v1/chat/conversations/{thread}/messages/", {"body": "note to self"}, format="json"
        )
        assert response.status_code == 201
