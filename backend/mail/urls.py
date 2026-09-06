from django.urls import path
from rest_framework.routers import DefaultRouter

from mail.viewsets import (
    EmailAttachmentDownloadView,
    EmailMessageViewSet,
    IncomingLetterViewSet,
    OutgoingLetterViewSet,
)

app_name = "mail"

router = DefaultRouter()
router.register("messages", EmailMessageViewSet, basename="message")
# The correspondence register — the chalani and darta books, which are a
# different object from the mailbox above. See `mail.models`.
router.register("outgoing", OutgoingLetterViewSet, basename="outgoing-letter")
router.register("incoming", IncomingLetterViewSet, basename="incoming-letter")

# Non-router route first, so the messages/{pk}/ detail pattern can't shadow it.
urlpatterns = [
    path("attachments/<int:pk>/download/", EmailAttachmentDownloadView.as_view(), name="attachment-download"),
    *router.urls,
]
