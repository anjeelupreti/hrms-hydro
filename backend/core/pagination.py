from rest_framework.pagination import PageNumberPagination

from core.filters import IdsLookupMixin


class DefaultPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100

    def get_page_size(self, request):
        """Let an ``?ids=`` lookup fetch its whole selection in one request.

        The cap exists to stop a client dumping a table. An ids lookup can't:
        the row count is bounded by the ids named in the query string, which
        `IdsLookupMixin` truncates to MAX_IDS. Without this, a roster with
        150 people selected would silently render the first 100 with names and
        the rest as bare numbers.
        """
        if request.query_params.get("ids"):
            requested = request.query_params.get(self.page_size_query_param)
            if requested and requested.isdigit() and int(requested) > 0:
                return min(int(requested), IdsLookupMixin.MAX_IDS)
            return IdsLookupMixin.MAX_IDS
        return super().get_page_size(request)
