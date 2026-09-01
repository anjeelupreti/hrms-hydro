"""The chat WebSocket consumer.

Channels has no per-request middleware stack like Django HTTP, so this
consumer does its own auth: a short-lived signed ticket on the query string
(see chat/tickets.py) — the browser never has the real JWT.

Message send/edit/delete and typing all flow over this socket; the REST
side (viewsets.py) only handles initial load, conversation creation, and
minting the connection ticket.
"""

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.core import signing
from django.utils import timezone

from chat import presence, services
from chat.models import Conversation, ConversationMembership, Message
from chat.tickets import read_ticket


class ChatConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        ticket = self._ticket_from_query()
        if not ticket:
            await self.close(code=4001)
            return
        try:
            payload = read_ticket(ticket)
        except (signing.BadSignature, signing.SignatureExpired):
            await self.close(code=4001)
            return

        self.user_id = payload["user_id"]

        self.user = await self._load_user()
        if self.user is None:
            await self.close(code=4001)
            return

        self.conversation_ids = set(await self._load_conversation_ids())
        self.user_group = services.user_group(self.user_id)

        await self.channel_layer.group_add(self.user_group, self.channel_name)
        for cid in self.conversation_ids:
            await self.channel_layer.group_add(
                services.conv_group(cid), self.channel_name
            )
        await self.accept()

        # Presence is counted, not a flag — one person has several tabs, and a
        # boolean set false by any disconnect would show them offline while
        # they are still connected elsewhere. Only the *first* connection is
        # worth announcing; the second tab changes nothing anyone can see.
        became_online = await database_sync_to_async(presence.connected)(self.user_id)
        if became_online:
            await self._broadcast_presence(True)

    async def disconnect(self, code):
        if not hasattr(self, "conversation_ids"):
            return  # rejected before we joined anything

        # Only announce when the *last* connection closes. Closing one of three
        # tabs is not going offline.
        went_offline = await database_sync_to_async(presence.disconnected)(self.user_id)
        if went_offline:
            await database_sync_to_async(self._touch_last_seen)()
            await self._broadcast_presence(False)

        await self.channel_layer.group_discard(self.user_group, self.channel_name)
        for cid in self.conversation_ids:
            await self.channel_layer.group_discard(
                services.conv_group(cid), self.channel_name
            )

    async def _broadcast_presence(self, is_online):
        """Tell this user's conversations that they arrived or left.

        Scoped to their conversations rather than everybody: presence is
        only useful next to a name you can already see, and fanning it out to
        everybody makes every login an N-way broadcast.
        """
        for cid in self.conversation_ids:
            await self.channel_layer.group_send(
                services.conv_group(cid),
                {
                    "type": "chat.presence",
                    "user_id": self.user_id,
                    "is_online": is_online,
                },
            )

    def _touch_last_seen(self):
        from employees.models import Employee

        presence.touch_last_seen(Employee.objects.filter(user_id=self.user_id).first())

    async def chat_presence(self, event):
        # Never echo a user's own presence back to them — they know.
        if event["user_id"] == self.user_id:
            return
        await self.send_json({
            "type": "presence",
            "user_id": event["user_id"],
            "is_online": event["is_online"],
        })

    # --- inbound (client -> server) ---------------------------------------

    async def receive_json(self, content):
        action = content.get("action")
        if action == "message.send":
            await self._handle_send(content)
        elif action == "message.edit":
            await self._handle_edit(content)
        elif action == "message.delete":
            await self._handle_delete(content)
        elif action == "typing":
            await self._handle_typing(content)
        elif action == "ping":
            # Refreshes the presence TTL. Without a heartbeat a long-idle tab
            # would expire and read as offline while its socket is still open.
            await database_sync_to_async(presence.heartbeat)(self.user_id)
        elif action == "mark_read":
            await self._handle_mark_read(content)

    async def _handle_send(self, content):
        conversation_id = content.get("conversation")
        body = (content.get("body") or "").strip()
        if not body or conversation_id not in self.conversation_ids:
            return
        payload = await self._create_message(conversation_id, body)
        await self.channel_layer.group_send(
            services.conv_group(conversation_id),
            {
                "type": "chat.message",
                "message": payload,
                "client_id": content.get("client_id"),
            },
        )

    async def _handle_edit(self, content):
        payload = await self._edit_message(content.get("message_id"), (content.get("body") or "").strip())
        if payload is None:
            return
        await self.channel_layer.group_send(
            services.conv_group(payload["conversation"]),
            {"type": "chat.message_edited", "message": payload},
        )

    async def _handle_delete(self, content):
        payload = await self._delete_message(content.get("message_id"))
        if payload is None:
            return
        await self.channel_layer.group_send(
            services.conv_group(payload["conversation"]),
            {"type": "chat.message_deleted", "message": payload},
        )

    async def _handle_typing(self, content):
        conversation_id = content.get("conversation")
        if conversation_id not in self.conversation_ids:
            return
        await self.channel_layer.group_send(
            services.conv_group(conversation_id),
            {
                "type": "chat.typing",
                "conversation": conversation_id,
                "user_id": self.user_id,
                "sender_name": services.sender_display(self.user),
            },
        )

    async def _handle_mark_read(self, content):
        conversation_id = content.get("conversation")
        if conversation_id in self.conversation_ids:
            await self._mark_read(conversation_id)

    # --- outbound (channel layer -> client) -------------------------------

    async def chat_message(self, event):
        await self.send_json(
            {"type": "message.new", "message": event["message"], "client_id": event.get("client_id")}
        )

    async def chat_message_edited(self, event):
        await self.send_json({"type": "message.edited", "message": event["message"]})

    async def chat_message_deleted(self, event):
        await self.send_json({"type": "message.deleted", "message": event["message"]})

    async def chat_typing(self, event):
        # The typist is in this group too; the client ignores its own user_id.
        await self.send_json(
            {
                "type": "typing",
                "conversation": event["conversation"],
                "user_id": event["user_id"],
                "sender_name": event["sender_name"],
            }
        )

    async def conversation_new(self, event):
        cid = event["conversation_id"]
        self.conversation_ids.add(cid)
        await self.channel_layer.group_add(services.conv_group(cid), self.channel_name)
        await self.send_json({"type": "conversation.new", "conversation": event["payload"]})

    # --- helpers ----------------------------------------------------------

    def _ticket_from_query(self):
        params = parse_qs(self.scope["query_string"].decode())
        values = params.get("ticket")
        return values[0] if values else None

    @database_sync_to_async
    def _load_user(self):
        from accounts.models import User

        return User.objects.filter(pk=self.user_id, is_active=True).first()

    @database_sync_to_async
    def _load_conversation_ids(self):
        return list(
            ConversationMembership.objects.filter(user_id=self.user_id).values_list(
                "conversation_id", flat=True
            )
        )

    # These return the *serialised* payload, not the model instance. Handing a
    # Message back to the async caller looks harmless but isn't:
    # message_to_dict() walks `message.attachments`, and that lazy query would
    # then run on the event loop and raise SynchronousOnlyOperation — which
    # Channels turns into a 1011 close. The row was already committed by then,
    # so the symptom was a message that saved but was never echoed to anyone.
    # Serialising while still on the worker thread keeps every ORM access
    # inside database_sync_to_async.

    @database_sync_to_async
    def _create_message(self, conversation_id, body):
        message = Message.objects.create(
            conversation_id=conversation_id, sender=self.user, body=body
        )
        Conversation.objects.filter(pk=conversation_id).update(updated_at=timezone.now())
        message.sender = self.user  # avoid a re-query in message_to_dict
        return services.message_to_dict(message)

    @database_sync_to_async
    def _edit_message(self, message_id, body):
        if not body:
            return None
        message = Message.objects.filter(
            pk=message_id, sender_id=self.user_id, deleted_at__isnull=True
        ).first()
        if message is None:
            return None
        message.body = body
        message.edited_at = timezone.now()
        message.save(update_fields=["body", "edited_at", "updated_at"])
        message.sender = self.user
        return services.message_to_dict(message)

    @database_sync_to_async
    def _delete_message(self, message_id):
        message = Message.objects.filter(
            pk=message_id, sender_id=self.user_id, deleted_at__isnull=True
        ).first()
        if message is None:
            return None
        message.deleted_at = timezone.now()
        message.body = ""  # deleted content is genuinely gone, not just hidden
        message.save(update_fields=["deleted_at", "body", "updated_at"])
        message.sender = self.user
        return services.message_to_dict(message)

    @database_sync_to_async
    def _mark_read(self, conversation_id):
        ConversationMembership.objects.filter(
            conversation_id=conversation_id, user_id=self.user_id
        ).update(last_read_at=timezone.now())
