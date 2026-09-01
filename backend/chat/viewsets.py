from django.http import FileResponse
from django.utils import timezone
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet

from accounts.models import User
from chat import presence, services
from chat.models import ChatAttachment, Conversation, ConversationMembership, Message
from chat.serializers import (
    ConversationCreateSerializer,
    ConversationSerializer,
    MessageSerializer,
    ParticipantSerializer,
)
from chat.tickets import mint_ticket
from employees.models import Employee

HISTORY_PAGE_SIZE = 50


class ConversationViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, GenericViewSet):
    serializer_class = ConversationSerializer

    def get_queryset(self):
        # Only conversations I'm a member of — so get_object() 404s a
        # non-member, which is the whole access check for messages/mark_read.
        return (
            Conversation.objects.filter(memberships__user=self.request.user)
            .prefetch_related("memberships__user")
            .distinct()
        )

    def create(self, request, *args, **kwargs):
        write = ConversationCreateSerializer(data=request.data, context={"request": request})
        write.is_valid(raise_exception=True)
        conv = write.save()
        # Re-fetch through get_queryset so memberships__user is prefetched for
        # the response serializer (a freshly-created instance isn't).
        conv = self.get_queryset().get(pk=conv.pk)
        out = ConversationSerializer(conv, context={"request": request})
        if getattr(write, "_created_new", False):
            services.notify_conversation_created(
                conv.pk, write._member_ids, out.data
            )
        return Response(out.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def saved(self, request, *args, **kwargs):
        """The caller's own thread, created on first ask.

        **Get-or-create, not create.** A note to yourself is somewhere you go,
        not something you set up, so there is no "start your notes" step and no
        way to end up with two of them. The unique-ish guarantee is the filter
        on `type=SELF` plus own membership — a second one can only appear if two
        requests race, and `first()` then makes that harmless rather than an
        error, which is the right trade for a scratchpad.

        Not routed through `ConversationCreateSerializer` on purpose: that
        serializer's whole job is validating who else is in the room, and there
        is nobody else in this one.
        """
        conv = (
            Conversation.objects.filter(type=Conversation.Type.SELF, memberships__user=request.user)
            .prefetch_related("memberships__user")
            .first()
        )
        if conv is None:
            conv = Conversation.objects.create(type=Conversation.Type.SELF)
            ConversationMembership.objects.create(conversation=conv, user=request.user)
            conv = self.get_queryset().get(pk=conv.pk)
        return Response(ConversationSerializer(conv, context={"request": request}).data)

    @action(detail=True, methods=["get", "post"])
    def messages(self, request, pk=None, **kwargs):
        if request.method == "POST":
            return self._post_message(request)
        conv = self.get_object()
        qs = conv.messages.select_related("sender").prefetch_related("attachments").order_by("-created_at")
        before = request.query_params.get("before")
        if before:
            qs = qs.filter(id__lt=before)
        # Fetch one extra to know whether older messages remain.
        window = list(qs[: HISTORY_PAGE_SIZE + 1])
        has_more = len(window) > HISTORY_PAGE_SIZE
        window = window[:HISTORY_PAGE_SIZE]
        window.reverse()  # chronological for display
        return Response(
            {"results": MessageSerializer(window, many=True).data, "has_more": has_more}
        )

    def _post_message(self, request):
        """Send a plain text message over REST.

        The WebSocket is the normal path — it is what makes the thread feel
        live — but it is not the only one. A blocked socket (corporate proxy,
        flaky network, a reverse proxy that does not forward Upgrade) would
        otherwise mean the send button silently does nothing, since message
        creation would exist nowhere else. The client falls back here whenever
        the socket is not OPEN, and the broadcast below still reaches everyone
        whose socket is up.
        """
        conv = self.get_object()  # membership enforced via get_queryset
        body = (request.data.get("body") or "").strip()
        if not body:
            return Response({"detail": "Message body is required."}, status=status.HTTP_400_BAD_REQUEST)
        message = Message.objects.create(conversation=conv, sender=request.user, body=body)
        Conversation.objects.filter(pk=conv.pk).update(updated_at=timezone.now())
        services.broadcast_message(
            message, client_id=request.data.get("client_id")
        )
        return Response(services.message_to_dict(message), status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None, **kwargs):
        conv = self.get_object()
        ConversationMembership.objects.filter(conversation=conv, user=request.user).update(
            last_read_at=timezone.now()
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def upload(self, request, pk=None, **kwargs):
        """Create a message carrying one or more file attachments (multipart),
        then broadcast it to the conversation like a normal message. The WS
        can't carry binary, so uploads take this REST path."""
        conv = self.get_object()  # membership enforced via get_queryset
        files = request.FILES.getlist("files") or request.FILES.getlist("file")
        if not files:
            return Response({"detail": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)
        message = Message.objects.create(
            conversation=conv, sender=request.user, body=(request.data.get("body") or "").strip()
        )
        for f in files:
            ChatAttachment.objects.create(
                message=message, file=f, filename=f.name[:255], content_type=getattr(f, "content_type", "")
            )
        Conversation.objects.filter(pk=conv.pk).update(updated_at=timezone.now())
        services.broadcast_message(message)
        return Response(services.message_to_dict(message), status=status.HTTP_201_CREATED)


class ParticipantsView(APIView):
    """Everyone you could start a conversation with — every active user in
    the company except yourself. Chat is user-scoped (not employee-scoped) so
    accounts without an Employee record (e.g. the HR admin) are included."""

    def get(self, request, **kwargs):
        users = User.objects.filter(is_active=True).exclude(id=request.user.id).order_by(
            "first_name", "last_name", "username"
        )
        return Response(ParticipantSerializer(users, many=True).data)


class ChatAttachmentDownloadView(APIView):
    """Serves an attachment through the BFF (so the browser never needs a
    direct /media URL). Only members of the attachment's conversation may
    fetch it."""

    def get(self, request, pk, **kwargs):
        try:
            att = ChatAttachment.objects.select_related("message__conversation").get(pk=pk)
        except ChatAttachment.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        is_member = ConversationMembership.objects.filter(
            conversation=att.message.conversation_id, user=request.user
        ).exists()
        if not is_member:
            return Response(status=status.HTTP_403_FORBIDDEN)
        response = FileResponse(att.file.open("rb"), content_type=att.content_type or "application/octet-stream")
        response["Content-Disposition"] = f'inline; filename="{att.filename}"'
        return response


class WsTicketView(APIView):
    """Mints a short-lived ticket the browser uses to open the chat socket.
    Pinned to the current company schema and the authenticated user."""

    def post(self, request, **kwargs):
        ticket = mint_ticket(request.user.id)
        return Response({"ticket": ticket})


class PresenceView(APIView):
    """Who, among these users, is online right now.

    Takes an explicit id list rather than answering "everyone online": the only
    place presence is useful is beside a name already on screen, and a query
    that grows with the company serves nobody.

    Returns `last_seen_at` alongside, because "offline" on its own is not the
    answer anybody wants — "last seen 20 minutes ago" is.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        raw = request.query_params.get("user_ids", "")
        try:
            user_ids = [int(part) for part in raw.split(",") if part.strip()]
        except ValueError:
            return Response(
                {"detail": "user_ids must be a comma-separated list of ids."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not user_ids:
            return Response({"presence": []})

        online = presence.online_user_ids(user_ids)
        last_seen = dict(
            Employee.objects.filter(user_id__in=user_ids).values_list("user_id", "last_seen_at")
        )
        return Response({
            "presence": [
                {
                    "user_id": uid,
                    "is_online": uid in online,
                    "last_seen_at": last_seen.get(uid),
                }
                for uid in user_ids
            ]
        })
