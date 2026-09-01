from django.urls import path
from rest_framework.routers import DefaultRouter

from mail.viewsets import EmailAttachmentDownloadView, EmailMessageViewSet

app_name = "mail"

router = DefaultRouter()
router.register("messages", EmailMessageViewSet, basename="message")

# Non-router route first, so the messages/{pk}/ detail pattern can't shadow it.
urlpatterns = [
    path("attachments/<int:pk>/download/", EmailAttachmentDownloadView.as_view(), name="attachment-download"),
    *router.urls,
]
