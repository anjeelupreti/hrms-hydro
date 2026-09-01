from django.http import FileResponse
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet

from accounts.permissions import IsHRAdmin
from accounts.policy import Perm
from mail import services
from mail.models import EmailAttachment, EmailMessage
from mail.serializers import (
    EmailMessageDetailSerializer,
    EmailMessageListSerializer,
    SendEmailSerializer,
)

# Gated in both directions — reads included: the company mailbox uses the
# company's real, shared email credentials and carries inbound mail nobody
# consented to share.
#
# `MAIL_ACCESS` is its own capability rather than `IsHRAdmin`'s default of
# `PEOPLE_MANAGE`: who may read the company mail and who maintains employment
# records are two questions, and one switch cannot answer both. Held by owners
# and HR admins out of the box, grantable to anybody else from Roles &
# permissions.
PERMISSION_CLASSES = [IsAuthenticated, IsHRAdmin]
REQUIRED_PERMISSION = Perm.MAIL_ACCESS


class EmailMessageViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, GenericViewSet):
    permission_classes = PERMISSION_CLASSES
    required_permission = REQUIRED_PERMISSION

    def get_queryset(self):
        folder = self.request.query_params.get("folder", EmailMessage.Folder.INBOX)
        return EmailMessage.objects.filter(folder=folder).prefetch_related("attachments")

    def get_serializer_class(self):
        return EmailMessageDetailSerializer if self.action == "retrieve" else EmailMessageListSerializer

    def retrieve(self, request, *args, **kwargs):
        message = self.get_object()
        if not message.is_read:
            message.is_read = True
            message.save(update_fields=["is_read"])
        return Response(EmailMessageDetailSerializer(message).data)

    @action(detail=False, methods=["post"])
    def sync(self, request, **kwargs):
        try:
            count = services.sync_inbox()
        except Exception as exc:  # IMAP/login/network failure
            return Response(
                {"detail": f"Sync failed: {exc}"}, status=status.HTTP_400_BAD_REQUEST
            )
        return Response({"synced": count})

    @action(detail=False, methods=["post"])
    def send(self, request, **kwargs):
        serializer = SendEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            record = services.send_email(
                to=data["to"], subject=data["subject"], body=data["body"], cc=data.get("cc")
            )
        except Exception as exc:
            return Response({"detail": f"Send failed: {exc}"}, status=status.HTTP_400_BAD_REQUEST)
        return Response(EmailMessageDetailSerializer(record).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request, **kwargs):
        count = EmailMessage.objects.filter(
            folder=EmailMessage.Folder.INBOX, is_read=False
        ).count()
        return Response({"count": count})


class EmailAttachmentDownloadView(APIView):
    permission_classes = PERMISSION_CLASSES
    # The same gate as the message it hangs off — an attachment is not less
    # sensitive than the mail that carried it.
    required_permission = REQUIRED_PERMISSION

    def get(self, request, pk, **kwargs):
        try:
            attachment = EmailAttachment.objects.get(pk=pk)
        except EmailAttachment.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        response = FileResponse(attachment.file.open("rb"), content_type=attachment.content_type or "application/octet-stream")
        response["Content-Disposition"] = f'attachment; filename="{attachment.filename}"'
        return response
