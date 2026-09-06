from django.http import FileResponse
from django_filters import rest_framework as django_filters
from rest_framework import filters, mixins, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from accounts.permissions import IsHRAdmin
from accounts.policy import Perm
from mail import services
from core.viewsets import AuditViewSetMixin
from mail.models import (
    EmailAttachment,
    EmailMessage,
    IncomingLetter,
    LetterAttachment,
    OutgoingLetter,
)
from mail.serializers import (
    EmailMessageDetailSerializer,
    EmailMessageListSerializer,
    SendEmailSerializer,
    IncomingLetterSerializer,
    LetterAttachmentSerializer,
    OutgoingLetterSerializer,
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


class _LetterViewSet(AuditViewSetMixin, ModelViewSet):
    """What the two registers share: attachments, and a suggested next number."""

    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]

    @action(detail=False, methods=["get"], url_path="next-ref")
    def next_ref(self, request, *args, **kwargs):
        """A suggestion, not an allocation.

        The office types its own reference, so nothing is reserved here — this
        only looks at the highest trailing number already used and offers one
        past it. Two people opening the form at once will be offered the same
        number and the second will be told it is taken, which is the same thing
        the paper register does.
        """
        company = request.query_params.get("company")
        rows = self.get_queryset()
        if company:
            rows = rows.filter(company_id=company)

        highest = 0
        for ref in rows.values_list("ref", flat=True):
            digits = "".join(ch for ch in str(ref) if ch.isdigit())
            if digits:
                highest = max(highest, int(digits[-6:]))
        return Response({"suggestion": f"{self.ref_prefix}-{highest + 1:04d}"})

    @action(detail=True, methods=["post"], url_path="attachments")
    def add_attachment(self, request, *args, **kwargs):
        letter = self.get_object()
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"detail": "No file."}, status=status.HTTP_400_BAD_REQUEST)
        row = LetterAttachment.objects.create(
            **{self.attachment_field: letter},
            file=upload,
            caption=request.data.get("caption", ""),
        )
        return Response(
            LetterAttachmentSerializer(row, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(
        detail=True,
        methods=["delete"],
        url_path=r"attachments/(?P<attachment_id>[0-9]+)",
    )
    def remove_attachment(self, request, attachment_id=None, *args, **kwargs):
        letter = self.get_object()
        row = letter.attachments.filter(pk=attachment_id).first()
        if row is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        row.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class OutgoingLetterViewSet(_LetterViewSet):
    """The outgoing register, which also does the posting.

    **Saving records it; sending is a separate act.** They are not one button
    because attachments are added after the row exists — a file needs something
    to belong to — and because a letter that is going by hand should be in the
    register without anybody pretending an email was tried. So: save, attach,
    then Send.
    """

    serializer_class = OutgoingLetterSerializer
    queryset = OutgoingLetter.objects.prefetch_related("attachments", "replies").select_related("company")
    filterset_fields = ["company", "status", "letter_date"]
    search_fields = ["ref", "subject", "addressed_to", "body"]
    ordering_fields = ["letter_date", "ref", "created_at"]
    ref_prefix = "OUT"
    attachment_field = "outgoing"

    @action(detail=True, methods=["post"])
    def send(self, request, *args, **kwargs):
        """Post it, and record what happened either way.

        The row is already written and is never rolled back — see
        `services.send_outgoing_letter`. A failure stores the reason and leaves
        this button available, because a registry that quietly loses letters is
        worse than a paper one.
        """
        letter = self.get_object()
        services.send_outgoing_letter(letter, actor=request.user)
        letter.refresh_from_db()
        return Response(
            OutgoingLetterSerializer(letter, context={"request": request}).data
        )


class IncomingLetterViewSet(_LetterViewSet):
    """The incoming register, entered by hand.

    Nothing is synced: letters arrive by post, by hand and into half a dozen
    personal mailboxes, and a register that only captured one monitored inbox
    would have holes in it and no way to tell.
    """

    serializer_class = IncomingLetterSerializer
    queryset = IncomingLetter.objects.prefetch_related("attachments", "notify__user").select_related(
        "company", "in_reply_to"
    )
    filterset_fields = ["company", "received_via", "received_on", "in_reply_to"]
    search_fields = ["ref", "subject", "from_office", "from_person", "note"]
    ordering_fields = ["received_on", "letter_date", "ref"]
    ref_prefix = "IN"
    attachment_field = "incoming"

    def perform_create(self, serializer):
        letter = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        self._tell_them(letter)

    def perform_update(self, serializer):
        before = set(serializer.instance.notify.values_list("pk", flat=True))
        letter = serializer.save(updated_by=self.request.user)
        # Only the people newly added. Re-notifying everybody because somebody
        # fixed a typo is how a notification stops being read.
        self._tell_them(letter, only=set(letter.notify.values_list("pk", flat=True)) - before)

    def _tell_them(self, letter, only=None):
        """**The point of registering a letter is that it reaches somebody.**

        In the product and by email, because the person who needs to see a
        letter from the district office is frequently not at their desk.
        """
        from notifications.services import notify

        people = letter.notify.select_related("user")
        if only is not None:
            people = people.filter(pk__in=only)
        for person in people:
            notify(
                person.user,
                "letter_received",
                f"{letter.ref} from {letter.from_office} — {letter.subject}",
                email_subject=f"Letter received: {letter.subject}",
            )
