from rest_framework import serializers

from helpdesk.models import Ticket, TicketComment


def _emp_name(emp):
    if emp is None:
        return None
    return emp.user.get_full_name() or emp.user.get_username()


class TicketCommentSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = TicketComment
        fields = ["id", "body", "author_name", "created_at"]
        read_only_fields = ["id", "author_name", "created_at"]

    def get_author_name(self, obj):
        if obj.created_by is None:
            return None
        return obj.created_by.get_full_name() or obj.created_by.get_username()


class TicketSerializer(serializers.ModelSerializer):
    comments = TicketCommentSerializer(many=True, read_only=True)
    requester_name = serializers.SerializerMethodField()
    assignee_name = serializers.SerializerMethodField()

    class Meta:
        model = Ticket
        fields = [
            "id", "subject", "description", "category", "priority", "status",
            "requester", "requester_name", "assignee", "assignee_name",
            "comments", "resolved_at", "created_at",
        ]
        read_only_fields = [
            "id", "requester", "requester_name", "assignee_name", "status",
            "comments", "resolved_at", "created_at",
        ]

    def get_requester_name(self, obj):
        return _emp_name(obj.requester)

    def get_assignee_name(self, obj):
        return _emp_name(obj.assignee)
