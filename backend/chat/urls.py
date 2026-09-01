from django.urls import path
from rest_framework.routers import DefaultRouter

from chat.viewsets import (
    ChatAttachmentDownloadView,
    ConversationViewSet,
    ParticipantsView,
    PresenceView,
    WsTicketView,
)

app_name = "chat"

router = DefaultRouter()
router.register("conversations", ConversationViewSet, basename="conversation")

# Non-router routes first, so the router's conversations/{pk}/ detail
# pattern can't shadow them (same load-bearing ordering as the
# notifications app).
urlpatterns = [
    path("presence/", PresenceView.as_view(), name="chat-presence"),
    path("participants/", ParticipantsView.as_view(), name="participants"),
    path("ws-ticket/", WsTicketView.as_view(), name="ws-ticket"),
    path("attachments/<int:pk>/download/", ChatAttachmentDownloadView.as_view(), name="attachment-download"),
    *router.urls,
]
