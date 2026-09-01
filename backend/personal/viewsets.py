from django.utils import timezone
from django_filters import rest_framework as django_filters
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Todo
from .serializers import TodoSerializer


class TodoViewSet(viewsets.ModelViewSet):
    """Your own list. Nobody else's, including the owner's.

    **The queryset is the permission check, and it is the only one there is.**
    Every action — retrieve, update, destroy, the lot — runs through
    `get_queryset`, so a to-do belonging to somebody else is not "forbidden", it
    does not exist. That is the right answer for a private list: a 403 on a
    row you cannot see still confirms the row is there.

    Note the absence of a permission class beyond authentication. An owner or an
    HR admin has no business reading these, and giving `settings.manage` a way
    in — the pattern most of this codebase uses — would quietly turn a private
    scratchpad into something management can read. A personal list that the boss
    can open is not a personal list, and nobody would use it twice.
    """

    serializer_class = TodoSerializer
    permission_classes = [IsAuthenticated]
    #: `search_fields` is only read by `SearchFilter`, and the project default
    #: is `DjangoFilterBackend` alone — so declaring the fields without naming
    #: the backend gives a search box that quietly returns everything.
    filter_backends = [django_filters.DjangoFilterBackend, filters.SearchFilter]
    filterset_fields: list[str] = []
    search_fields = ["title", "notes"]

    def get_queryset(self):
        queryset = Todo.objects.filter(owner=self.request.user)
        # Ownership is the access rule and applies to every action; which rows
        # the *list* shows is a listing concern. `get_object` goes through
        # `get_queryset` too, so applying the archive filter unconditionally
        # would make an archived row unfetchable by id — and `restore` would
        # 404 on precisely the rows it exists for.
        if self.action != "list":
            return queryset
        archived = self.request.query_params.get("archived")
        if archived in ("1", "true"):
            return queryset.exclude(archived_at=None)
        return queryset.filter(archived_at=None)

    def perform_create(self, serializer):
        # New items go to the top of the list. Somebody writing a to-do down is
        # usually thinking about it right now, and appending it below thirty
        # older ones buries the one thing they came here to record.
        lowest = (
            Todo.objects.filter(owner=self.request.user, archived_at=None)
            .order_by("order")
            .values_list("order", flat=True)
            .first()
        )
        serializer.save(owner=self.request.user, order=(lowest or 0) - 1)

    @action(detail=True, methods=["post"])
    def toggle(self, request, *args, **kwargs):
        """Tick or untick. One endpoint, because it is one gesture."""
        todo = self.get_object()
        todo.done_at = None if todo.done_at else timezone.now()
        todo.save(update_fields=["done_at", "updated_at"])
        return Response(self.get_serializer(todo).data)

    @action(detail=True, methods=["post"])
    def archive(self, request, *args, **kwargs):
        todo = self.get_object()
        todo.archived_at = timezone.now()
        todo.save(update_fields=["archived_at", "updated_at"])
        return Response(self.get_serializer(todo).data)

    @action(detail=True, methods=["post"])
    def restore(self, request, *args, **kwargs):
        """Undo an archive.

        Without this, archiving is a one-way door with no visible handle — and a
        one-way door is what makes people use delete instead, which is the
        outcome archiving exists to avoid.
        """
        todo = self.get_object()
        todo.archived_at = None
        todo.save(update_fields=["archived_at", "updated_at"])
        return Response(self.get_serializer(todo).data)

    @action(detail=False, methods=["post"])
    def reorder(self, request, *args, **kwargs):
        """Take the ids in their new order and write positions in one pass."""
        ids = request.data.get("ids")
        if not isinstance(ids, list):
            return Response(
                {"detail": "Send `ids` as a list in the new order."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Filtered through the caller's own queryset, so an id from somebody
        # else's list is dropped rather than reordered. Archived rows are
        # excluded explicitly: positions describe the live list, and the ids
        # here can only have come from it.
        owned = {
            todo.id: todo
            for todo in self.get_queryset().filter(id__in=ids, archived_at=None)
        }
        updates = []
        for position, todo_id in enumerate(ids):
            todo = owned.get(todo_id)
            if todo is None:
                continue
            todo.order = position
            updates.append(todo)
        if updates:
            Todo.objects.bulk_update(updates, ["order"])
        return Response({"reordered": len(updates)})
