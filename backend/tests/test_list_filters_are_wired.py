"""A declared list control must actually filter.

`DEFAULT_FILTER_BACKENDS` is `(DjangoFilterBackend,)` and nothing else. Two
consequences catch people out, and both fail *open* — the request succeeds and
returns more rows than were asked for, which looks like working software:

  * `search_fields` is read only by `SearchFilter`. Declared without naming that
    backend, a search box returns the whole table.
  * `DjangoFilterBackend` needs a `filterset_fields` or `filterset_class`. A
    view with neither accepts any query parameter and applies none of them.

A filter that silently widens is worse than no filter: the caller believes it
narrowed.
"""

import pytest
from django.utils import timezone

pytestmark = pytest.mark.django_db


def test_the_reviews_list_honours_its_cycle_filter(company, hr_user, hr_client):
    """`useReviews({ cycle })` sends `?cycle=`; it has to mean something."""
    from employees.models import Department, Designation, Employee
    from organization.models import Review, ReviewCycle

    dept = Department.objects.create(name="Eng", code="ENG-F1")
    desig = Designation.objects.create(title="Eng", department=dept)
    emp = Employee.objects.create(
        user=hr_user, employee_code="EMP-F1",
        date_joined=timezone.localdate(), department=dept, designation=desig,
    )
    first = ReviewCycle.objects.create(
        name="H1", start_date=timezone.localdate(), end_date=timezone.localdate()
    )
    second = ReviewCycle.objects.create(
        name="H2", start_date=timezone.localdate(), end_date=timezone.localdate()
    )
    Review.objects.create(cycle=first, employee=emp, reviewer=emp)
    Review.objects.create(cycle=second, employee=emp, reviewer=emp)

    everything = hr_client.get("/api/v1/organization/reviews/")
    assert everything.status_code == 200
    assert everything.data["count"] == 2, "fixture did not produce two reviews"

    narrowed = hr_client.get(f"/api/v1/organization/reviews/?cycle={first.id}")
    assert narrowed.status_code == 200
    assert narrowed.data["count"] == 1, (
        "?cycle= was accepted and ignored — the caller asked for one cycle "
        "and was handed every cycle's reviews"
    )


def test_the_personal_todo_list_honours_its_search(company, hr_user, hr_client):
    """`TodoViewSet` declares `search_fields`, so `?search=` must narrow.

    Declared without `SearchFilter` in `filter_backends`, this returns both
    rows and nothing anywhere reports a problem.
    """
    from personal.models import Todo

    # Owned by the same user the client is authenticated as: the
    # viewset's queryset *is* its permission check.
    Todo.objects.create(owner=hr_user, title="Renew the insurance policy")
    Todo.objects.create(owner=hr_user, title="Book the venue")

    everything = hr_client.get("/api/v1/personal/todos/")
    assert everything.status_code == 200
    assert everything.data["count"] == 2

    narrowed = hr_client.get("/api/v1/personal/todos/?search=insurance")
    assert narrowed.status_code == 200
    assert narrowed.data["count"] == 1, (
        "?search= was accepted and ignored — a search box that returns "
        "everything reads as 'no matches were excluded'"
    )
    assert "insurance" in narrowed.data["results"][0]["title"].lower()
