"""Filtering shared across the API."""


class IdsLookupMixin:
    """Resolve an explicit set of primary keys via ``?ids=3,17,204``.

    Searchable pickers page their options, so the record a form already has
    selected is usually *not* in the page currently on screen — pick employee
    #204, reopen the dialog, and the picker holds only the first page and
    renders a bare id instead of a name. Rather than issuing one detail request
    per selected row, the picker asks for exactly the ids it needs to label.

    This is a `filter_queryset` override rather than a filter backend because it
    has to *replace* the other filters, not join them. As a backend it would run
    alongside SearchFilter, so labelling the current selection while the user
    types a search that doesn't match it would return nothing and the chips
    would lose their names mid-keystroke.

    Bypassing the search/filter chain is safe here because the caller names the
    rows: the result can never exceed the selection the user already made, and
    it is capped at MAX_IDS so a hand-written query string cannot ask for the
    whole table. Object-level permissions and company scoping are unaffected —
    those live on `get_queryset`, which still runs first.
    """

    MAX_IDS = 200

    def filter_queryset(self, queryset):
        raw = self.request.query_params.get("ids")
        if not raw:
            return super().filter_queryset(queryset)

        ids = []
        for chunk in raw.split(",")[: self.MAX_IDS]:
            chunk = chunk.strip()
            if chunk.isdigit():
                ids.append(int(chunk))

        # An `ids` param that parsed to nothing means "none of them", not "all
        # of them" — falling through to the unfiltered queryset would hand the
        # whole table to a malformed request.
        return queryset.filter(pk__in=ids)
