from rest_framework import serializers

from .models import Todo


class TodoSerializer(serializers.ModelSerializer):
    is_done = serializers.BooleanField(read_only=True)
    is_archived = serializers.SerializerMethodField()

    class Meta:
        model = Todo
        fields = [
            "id",
            "title",
            "notes",
            "due_date",
            "done_at",
            "archived_at",
            "order",
            "is_done",
            "is_archived",
            "created_at",
            "updated_at",
        ]
        # `owner` is never accepted from the client. It is taken from the
        # request in `perform_create`, so there is no request body that can
        # write a to-do into somebody else's list.
        read_only_fields = ["done_at", "archived_at", "created_at", "updated_at"]

    def get_is_archived(self, obj) -> bool:
        return obj.archived_at is not None

    def validate_title(self, value):
        title = value.strip()
        if not title:
            raise serializers.ValidationError("A to-do needs a title.")
        return title
