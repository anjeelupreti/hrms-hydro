"""An asset's life story, not just who has it now.

The register answered "who holds this laptop" and could not answer "who had it
when the screen broke", because a `status` field was being overwritten and
nothing wrote down what it used to say. These pin the log that closes that.
"""

from datetime import date

import pytest

from assets.models import Asset, AssetEvent
from employees.models import Employee

pytestmark = pytest.mark.django_db

ASSETS = "/api/v1/assets/assets/"


@pytest.fixture
def laptop(db):
    return Asset.objects.create(
        name="ThinkPad T14", asset_tag="LAP-004", category=Asset.Category.LAPTOP
    )


@pytest.fixture
def holder(db, employee_user, company):
    return Employee.objects.create(
        user=employee_user, employee_code="EMP-A1",
        date_joined=date(2024, 1, 1), primary_company=company,
    )


def test_assigning_writes_a_history_entry(admin_client, laptop, holder):
    response = admin_client.post(
        f"{ASSETS}{laptop.pk}/assign/",
        {"employee": holder.pk, "note": "Issued at induction"},
        format="json",
    )
    assert response.status_code == 200, response.data

    history = admin_client.get(f"{ASSETS}{laptop.pk}/history/")
    assert history.status_code == 200, history.data
    assert len(history.data) == 1
    entry = history.data[0]
    assert entry["kind"] == "assigned"
    assert entry["custodian_name"] is not None
    assert entry["to_value"] == Asset.Status.ASSIGNED


def test_returning_records_who_had_it(admin_client, laptop, holder):
    """The question the register could not answer. The custodian is written on
    the entry rather than read back from the asset, which by then is empty."""
    admin_client.post(f"{ASSETS}{laptop.pk}/assign/", {"employee": holder.pk}, format="json")
    admin_client.post(f"{ASSETS}{laptop.pk}/return/", {}, format="json")

    history = admin_client.get(f"{ASSETS}{laptop.pk}/history/")

    returned = next(e for e in history.data if e["kind"] == "returned")
    assert returned["custodian"] == holder.pk
    laptop.refresh_from_db()
    assert laptop.assigned_to is None, "the asset itself no longer names them"


def test_sending_for_maintenance_moves_the_status_with_the_entry(admin_client, laptop):
    """Recording one without the other is how the register comes to say
    "available" about a laptop that is in a repair shop."""
    response = admin_client.post(
        f"{ASSETS}{laptop.pk}/history/",
        {"kind": "maintenance", "note": "Screen replacement"},
        format="json",
    )

    assert response.status_code == 201, response.data
    laptop.refresh_from_db()
    assert laptop.status == Asset.Status.MAINTENANCE
    assert response.data["from_value"] == Asset.Status.AVAILABLE
    assert response.data["to_value"] == Asset.Status.MAINTENANCE


def test_coming_back_from_maintenance_returns_it_to_its_holder(admin_client, laptop, holder):
    """A laptop repaired while assigned goes back to `assigned`, not to the
    store — the person never gave it up."""
    admin_client.post(f"{ASSETS}{laptop.pk}/assign/", {"employee": holder.pk}, format="json")
    admin_client.post(f"{ASSETS}{laptop.pk}/history/", {"kind": "maintenance"}, format="json")

    admin_client.post(f"{ASSETS}{laptop.pk}/history/", {"kind": "repaired"}, format="json")

    laptop.refresh_from_db()
    assert laptop.status == Asset.Status.ASSIGNED


def test_a_plain_note_leaves_the_status_alone(admin_client, laptop):
    admin_client.post(
        f"{ASSETS}{laptop.pk}/history/",
        {"kind": "note", "note": "Charger frayed, replace at next service"},
        format="json",
    )

    laptop.refresh_from_db()
    assert laptop.status == Asset.Status.AVAILABLE


def test_an_unknown_kind_is_refused_rather_than_stored(admin_client, laptop):
    response = admin_client.post(
        f"{ASSETS}{laptop.pk}/history/", {"kind": "exploded"}, format="json"
    )

    assert response.status_code == 400
    assert AssetEvent.objects.count() == 0


def test_an_employee_can_read_the_history_and_not_write_it(
    employee_client, admin_client, laptop, holder
):
    admin_client.post(f"{ASSETS}{laptop.pk}/assign/", {"employee": holder.pk}, format="json")

    read = employee_client.get(f"{ASSETS}{laptop.pk}/history/")
    assert read.status_code == 200
    assert len(read.data) == 1

    write = employee_client.post(
        f"{ASSETS}{laptop.pk}/history/", {"kind": "lost"}, format="json"
    )
    assert write.status_code == 403


def test_the_history_reads_newest_first(admin_client, laptop, holder):
    admin_client.post(f"{ASSETS}{laptop.pk}/assign/", {"employee": holder.pk}, format="json")
    admin_client.post(f"{ASSETS}{laptop.pk}/return/", {}, format="json")

    history = admin_client.get(f"{ASSETS}{laptop.pk}/history/")

    assert [e["kind"] for e in history.data] == ["returned", "assigned"]
