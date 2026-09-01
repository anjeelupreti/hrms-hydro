"""The contract a searchable picker depends on.

Every one of these guards a bug that is invisible on seed data and fatal on a
real company: pickers used to request `page_size=200`, which `max_page_size`
silently clamped to 100, so employee #101 onward could not be selected at all.
"""

from datetime import date

import pytest
from rest_framework import status

from accounts.models import User
from employees.models import Department, Designation, Employee

pytestmark = pytest.mark.django_db

# Comfortably past the 100-row page cap, so "the first page" and "everyone" are
# provably different sets.
ROSTER_SIZE = 120


@pytest.fixture
def big_roster(company):
    """More people than one page holds — the situation the picker exists for."""
    dept = Department.objects.create(name="Operations", code="OPS")
    desig = Designation.objects.create(title="Operator")
    created = []
    for i in range(ROSTER_SIZE):
        user = User.objects.create_user(
            username=f"person{i:03d}",
            email=f"person{i:03d}@t.test",
            password="pw",
            role=User.Role.EMPLOYEE,
            first_name=f"Person{i:03d}",
            last_name="Roster",
        )
        created.append(
            Employee.objects.create(
                user=user,
                employee_code=f"EMP-{i:03d}",
                date_joined=date(2026, 1, 1),
                department=dept,
                designation=desig,
            )
        )
    return created


def test_page_size_is_capped_so_pickers_cannot_load_everything(hr_client, big_roster):
    """The reason a picker must search server-side rather than load-then-filter."""
    response = hr_client.get("/api/v1/employees/employees/?page=1&page_size=500")

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] >= ROSTER_SIZE
    # Asked for 500, capped at 100. A client-side filter over this result set
    # can never reach the other 20+.
    assert len(response.data["results"]) == 100


def test_search_reaches_a_record_beyond_the_first_page(hr_client, big_roster):
    response = hr_client.get("/api/v1/employees/employees/?search=Person119")

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 1


def test_ids_lookup_returns_exactly_the_named_rows(hr_client, big_roster):
    wanted = sorted([big_roster[5].id, big_roster[110].id])

    response = hr_client.get(f"/api/v1/employees/employees/?ids={wanted[0]},{wanted[1]}")

    assert response.status_code == status.HTTP_200_OK
    assert sorted(r["id"] for r in response.data["results"]) == wanted


def test_ids_lookup_ignores_the_page_size_cap(hr_client, big_roster):
    """A 120-person roster must label all 120 chips, not the first 100."""
    ids = ",".join(str(e.id) for e in big_roster)

    response = hr_client.get(f"/api/v1/employees/employees/?ids={ids}")

    assert response.status_code == status.HTTP_200_OK
    assert len(response.data["results"]) == ROSTER_SIZE


def test_ids_lookup_wins_over_a_search_that_excludes_the_selection(hr_client, big_roster):
    """Selected chips keep their names while you type a search that misses them."""
    target = big_roster[7].id

    response = hr_client.get(f"/api/v1/employees/employees/?ids={target}&search=zzzznomatch")

    assert response.status_code == status.HTTP_200_OK
    assert [r["id"] for r in response.data["results"]] == [target]


def test_garbage_ids_return_nothing_rather_than_the_whole_table(hr_client, big_roster):
    """`ids=` that parses to nothing must mean "none", never "unfiltered"."""
    response = hr_client.get("/api/v1/employees/employees/?ids=notanumber,+,")

    assert response.status_code == status.HTTP_200_OK
    assert response.data["results"] == []


def test_ids_lookup_cannot_be_used_to_dump_the_table(hr_client, big_roster):
    """The row count stays bounded by MAX_IDS however long the query string is."""
    ids = ",".join(str(i) for i in range(1, 5000))

    response = hr_client.get(f"/api/v1/employees/employees/?ids={ids}")

    assert response.status_code == status.HTTP_200_OK
    assert len(response.data["results"]) <= 200


def test_departments_are_searchable(hr_client, company):
    """Had no SearchFilter at all — the picker could only filter what it had
    already downloaded."""
    Department.objects.create(name="Radiology", code="RAD")

    response = hr_client.get("/api/v1/employees/departments/?search=Radio")

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 1


def test_designations_are_searchable(hr_client, company):
    Designation.objects.create(title="Chief Archivist")

    response = hr_client.get("/api/v1/employees/designations/?search=Archiv")

    assert response.status_code == status.HTTP_200_OK
    assert response.data["count"] == 1
