"""Server-side bucket counts for list screens."""

from django.db.models import Count, Sum
from rest_framework.decorators import action
from rest_framework.response import Response


class StatusCountsMixin:
    """`GET …/status-counts` — how many rows sit in each state.

    Mixed into the list viewsets whose screens show filter chips above a table:
    payroll runs, leave, claims, expenses, tickets, projects, assets. The chips
    read their numbers from here rather than tallying the rows they were sent,
    because a page is capped at 100 rows and a tally of one page undercounts on
    exactly the companys where the number matters.

    The response covers *every* choice, including empty buckets — "Rejected: 0"
    is a fact worth stating, while an absent key reads as "unknown".

    Set `count_field` to the status column, and `sum_field` where money or hours
    make the bucket meaningful: a claims list is judged by amount as much as by
    volume.
    """

    #: The status/state column to group by.
    count_field = "status"
    #: Optional numeric column to total per bucket (amount, hours).
    sum_field: str | None = None

    def get_count_choices(self):
        """The full set of buckets, so empty ones still appear."""
        field = self.get_queryset().model._meta.get_field(self.count_field)
        return [choice for choice, _ in (field.choices or [])]

    def _filtered_except_status(self, request):
        """The list's own filters, minus the one the chips represent.

        DRF applies filter backends in `filter_queryset()`, and a custom
        `@action` does not get that for free — calling `get_queryset()` alone
        would count the whole company regardless of what the user had narrowed
        the table to.

        The status parameter itself is dropped before filtering: the chips have
        to keep reporting every bucket while one of them is selected, or picking
        "Draft" would leave the others reading zero. It is removed by swapping
        the underlying request's `GET` for a copy — which `request.query_params`
        proxies — so the viewset's own backends can be reused rather than
        reimplemented. A second filtering path would be a second thing to keep
        in step with `filterset_fields`.
        """
        params = request.query_params.copy()
        params.pop(self.count_field, None)

        underlying = request._request
        original = underlying.GET
        underlying.GET = params
        try:
            return self.filter_queryset(self.get_queryset())
        finally:
            underlying.GET = original

    @action(detail=False, methods=["get"], url_path="status-counts", pagination_class=None)
    def status_counts(self, request, *args, **kwargs):
        # Counted through a `pk__in` subquery rather than over the filtered
        # queryset directly. Several viewsets annotate their list — the project
        # list adds `Count("tasks")` so a row can show progress without a query
        # each — and an annotation over a reverse relation is a JOIN. Grouping
        # that by status counts the joined rows, so six projects with
        # thirty-seven tasks between them report as thirty-seven.
        #
        # Re-filtering the bare manager keeps every scoping and visibility rule
        # the viewset applied, since those are all expressed as filters, while
        # dropping the annotations and their joins.
        scoped = self._filtered_except_status(request)
        queryset = scoped.model._default_manager.filter(pk__in=scoped.values("pk"))

        # `distinct=True` because `sum_field` may itself span a reverse
        # relation, and that join comes back after the rebuild above has
        # stripped the viewset's. CRM invoices sum
        # `line_items__quantity * line_items__unit_price`, so without this the
        # count is the number of *line items*: six invoices reported as twelve.
        #
        # It cannot cost anything the other way. Where `sum_field` is a column
        # on the model there is no join, and `distinct` on the count is a
        # no-op; where it spans a relation the sum is *meant* to traverse it,
        # so only the count needed correcting.
        annotations = {"n": Count("id", distinct=True)}
        if self.sum_field:
            annotations["total"] = Sum(self.sum_field)

        # `.order_by()` clears any inherited ordering: Django puts explicit
        # ordering fields into the GROUP BY, so an `?ordering=name` reaching
        # this query would group by status *and* name and split every bucket
        # into one row per record. The `pk__in` rebuild above already discards
        # ordering, so this cannot fire today; it costs nothing and becomes
        # load-bearing the day that rebuild changes.
        rows = queryset.order_by().values(self.count_field).annotate(**annotations)
        by_value = {row[self.count_field]: row for row in rows}

        def bucket(choice):
            row = by_value.get(choice, {})
            if not self.sum_field:
                return row.get("n", 0)
            return {"count": row.get("n", 0), "amount": str(row.get("total") or 0)}

        return Response(
            {
                "total": sum(row["n"] for row in rows),
                **{choice: bucket(choice) for choice in self.get_count_choices()},
            }
        )
