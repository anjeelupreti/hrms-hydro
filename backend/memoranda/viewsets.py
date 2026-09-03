from django.db.models import Count, Q
from django_filters import rest_framework as django_filters
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from accounts.permissions import IsHRAdminOrReadOnly
from accounts.policy import Perm, can
from core.viewsets import AuditViewSetMixin
from employees.models import Employee
from memoranda import workflow
from memoranda.models import (
    Memorandum,
    MemorandumAction,
    MemorandumAttachment,
    MemorandumEvent,
)
from memoranda.serializers import (
    MemorandumActionSerializer,
    MemorandumAttachmentSerializer,
    MemorandumListSerializer,
    MemorandumSerializer,
)
from memoranda.workflow import MemorandumError, NotYourTurn


class MemorandumActionViewSet(AuditViewSetMixin, ModelViewSet):
    """The vocabulary a handler picks from — *recommended*, *noted*, *verified*.

    **Configured, and read by everybody.** The same split the payroll component
    table has: the owner or an HR admin decides what the words are and what each
    one does to the chain, and every person handling a memorandum reads the list.
    Hiding it from readers would leave a dropdown they cannot see the meaning of.
    """

    serializer_class = MemorandumActionSerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]
    required_permission = Perm.SETTINGS_MANAGE
    filter_backends = [django_filters.DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["effect", "is_active", "for_approver"]
    ordering = ["order", "name"]

    def get_queryset(self):
        return MemorandumAction.objects.all()

    def destroy(self, request, *args, **kwargs):
        """Refused once it has been used.

        The log stores the word that was chosen, but the row is what a report
        groups by — and a memorandum whose recorded action points at nothing is
        one nobody can explain. Deactivating takes it out of every dropdown and
        keeps the history readable.
        """
        action_row = self.get_object()
        used = MemorandumEvent.objects.filter(action=action_row).count()
        if used:
            return Response(
                {
                    "detail": (
                        f"“{action_row.name}” has been used on {used} memorand"
                        f"{'um' if used == 1 else 'a'}. Deactivate it instead — "
                        "that removes it from the dropdown and keeps the record readable."
                    ),
                    "code": "action_in_use",
                },
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)


class MemorandumFilterSet(django_filters.FilterSet):
    mine = django_filters.BooleanFilter(method="filter_mine")

    class Meta:
        model = Memorandum
        fields = ["status", "stage", "company", "initiator", "approver"]

    def filter_mine(self, queryset, name, value):
        me = getattr(self.request.user, "employee", None)
        if not value or me is None:
            return queryset
        return queryset.filter(initiator=me)


class MemorandumViewSet(AuditViewSetMixin, ModelViewSet):
    """Memoranda, and the three lists every screen is built from.

    **Visibility is participation.** A memorandum is a private note between the
    people named on it until it is decided — so somebody sees one if they raised
    it, are in its chain, are its approver, or have handled it at some point.
    `people.admin` sees everything, because somebody has to be able to answer
    "where has this got to" when the person holding it is on leave.

    Every transition goes through `memoranda.workflow`. This class finds the
    memorandum, works out who is asking, and calls it — it never sets `stage`,
    `current_holder` or `status` itself.
    """

    permission_classes = [IsAuthenticated]
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_class = MemorandumFilterSet
    search_fields = ["memo_id", "subject", "content"]
    ordering_fields = ["submitted_at", "memo_date", "memo_id"]
    ordering = ["-submitted_at", "-created_at"]

    def get_serializer_class(self):
        return MemorandumListSerializer if self.action == "list" else MemorandumSerializer

    def _me(self):
        return getattr(self.request.user, "employee", None)

    def get_queryset(self):
        queryset = (
            Memorandum.objects.select_related(
                "company", "initiator__user", "approver__user", "current_holder__user"
            )
            .prefetch_related(
                "recommenders__employee__user",
                "attachments",
                "events__returned_to__user",
                # The history draws every comment's mentions and files in one
                # pass; without these two it is a query per line, which on a
                # memorandum that has been round the chain three times is
                # thirty round trips to render one dialog.
                "events__mentions__user",
                "events__attachments",
            )
            .annotate(
                # Only the annexes. A file on a comment is not part of the
                # proposal, and counting it here would make the list badge say
                # a memorandum has four attachments when it has one and three
                # replies.
                attachment_count=Count(
                    "attachments", filter=Q(attachments__event__isnull=True), distinct=True
                ),
                recommender_count=Count("recommenders", distinct=True),
            )
        )
        me = self._me()
        if can(self.request.user, Perm.PEOPLE_ADMIN):
            return queryset
        if me is None:
            return queryset.none()
        return queryset.filter(
            Q(initiator=me)
            | Q(approver=me)
            | Q(recommenders__employee=me)
            | Q(events__actor_employee=me)
            # Named in a comment. Being mentioned is what makes a memorandum
            # yours to read — a notice saying "you were mentioned on a document
            # you cannot open" is worse than no notice. It is a deliberate act
            # by somebody who already has access, exactly like adding a
            # recommender, and it grants reading and nothing else: acting on a
            # memorandum still requires being the holder.
            | Q(events__mentions=me)
        ).distinct()

    def handle_exception(self, exc):
        """A refusal from the workflow is a 400, wherever it was raised.

        `_run` catches `MemorandumError` around the transitions, and for a
        while that was every place one could come from. It is not: `create` and
        `update` reach `set_chain` and `set_approver` through DRF's own
        `perform_*` hooks, which nothing wraps — so the two refusals the owner
        asked for by name, *you cannot remove a recommender who has already
        acted* and *the approver cannot be changed once it has reached them*,
        both came back as a 500 with a stack trace and nothing on screen.

        Handled here rather than in each hook so the next transition added
        cannot forget: the exception is the refusal, and this is where it turns
        into an answer.
        """
        if isinstance(exc, NotYourTurn):
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        if isinstance(exc, MemorandumError):
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return super().handle_exception(exc)

    def perform_create(self, serializer):
        me = self._me()
        if me is None:
            raise MemorandumError("Your account has no employee record to raise a memorandum from.")
        recommender_ids = serializer.validated_data.pop("recommender_ids", [])
        memo = serializer.save(initiator=me, created_by=self.request.user, updated_by=self.request.user)
        if recommender_ids:
            workflow.set_chain(memo, recommender_ids, actor=self.request.user)
        workflow.log(memo, MemorandumEvent.Kind.CREATED, actor=self.request.user, employee=me)

    #: The text, which is the one document field that survives submission and
    #: therefore the only one this rule has to cover. `subject`, `memo_date`
    #: and `company` are frozen outright once a memorandum is sent — the
    #: serializer refuses them with a 400 whoever asks and wherever it is
    #: sitting — so putting them here would only change which of two refusals
    #: came back first. The chain and the approver are excluded on purpose;
    #: see `perform_update`.
    DOCUMENT_FIELDS = frozenset({"content"})

    def perform_update(self, serializer):
        # **Whose turn it is, enforced here and not only drawn in the browser.**
        # There was no check at all on this path: the queryset decides who may
        # *see* a memorandum, and everybody who could see one could PATCH it. So
        # the initiator could rewrite the text while a recommender was reading
        # it — somebody could be approving paragraph three while it was being
        # replaced underneath them, and what they signed was not what they read.
        #
        # Scoped to the document rather than to the whole request, because the
        # chain deliberately stays editable off-desk: a recommender goes on
        # leave and the initiator has to be able to route around them without
        # waiting for the person who is absent.
        me = self._me()
        touches_document = self.DOCUMENT_FIELDS & set(serializer.validated_data)
        if touches_document and not workflow.may_write(serializer.instance, me):
            raise NotYourTurn(
                "This memorandum is not with you. You can change what it says "
                "when it is a draft, or when it has been sent back to you."
            )
        if not touches_document and not (
            me and not serializer.instance.is_locked and serializer.instance.initiator_id == me.pk
        ):
            raise NotYourTurn("Only the initiator can change who signs this memorandum.")

        recommender_ids = serializer.validated_data.pop("recommender_ids", None)
        memo = serializer.instance
        was_content = serializer.validated_data.get("content")
        approver = serializer.validated_data.pop("approver", ...)

        memo = serializer.save(updated_by=self.request.user)
        if recommender_ids is not None:
            workflow.set_chain(memo, recommender_ids, actor=self.request.user)
        if approver is not ...:
            workflow.set_approver(memo, approver, actor=self.request.user)
        # Only worth a log line while it is in flight. Editing a draft is
        # writing it, and a history of every keystroke on an unsent note is
        # noise in the record that matters.
        if was_content is not None and memo.status != Memorandum.Status.DRAFT:
            workflow.log(
                memo, MemorandumEvent.Kind.EDITED,
                actor=self.request.user, employee=self._me(),
                comment="Content revised.",
            )

    def destroy(self, request, *args, **kwargs):
        memo = self.get_object()
        me = self._me()
        if memo.status != Memorandum.Status.DRAFT:
            return Response(
                {
                    "detail": (
                        "A submitted memorandum cannot be deleted — it has a number in "
                        "the company's register and people have written on it. Send it "
                        "back and let the approver reject it instead."
                    ),
                    "code": "submitted",
                },
                status=status.HTTP_409_CONFLICT,
            )
        if memo.initiator_id != getattr(me, "pk", None):
            return Response(
                {"detail": "Only the initiator can delete their own draft."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)

    # ── The three lists ──────────────────────────────────────────────────

    @action(detail=False, methods=["get"], url_path="my-desk")
    def my_desk(self, request, *args, **kwargs):
        """What this person needs to do, has raised, and has already handled.

        One request rather than three, because the page shows all three at once
        and three round trips would let them disagree about the same memorandum
        — one list still showing it as waiting while another has it as done.
        """
        me = self._me()
        base = self.get_queryset()
        if me is None:
            empty = MemorandumListSerializer([], many=True).data
            return Response({"awaiting_me": empty, "mine": empty, "handled": empty})

        awaiting = base.filter(
            current_holder=me, status=Memorandum.Status.IN_PROGRESS
        ).order_by("submitted_at")

        mine = base.filter(initiator=me).exclude(
            # Already at the top of the page if it is on their own desk.
            Q(current_holder=me) & Q(status=Memorandum.Status.IN_PROGRESS)
        )

        # Anything they have put a word on, whatever became of it. Read from the
        # log rather than from the chain, so somebody removed from a later
        # revision still finds the memorandum they signed.
        handled = base.filter(
            events__actor_employee=me,
            events__kind__in=[
                MemorandumEvent.Kind.PROCEEDED,
                MemorandumEvent.Kind.RETURNED,
                MemorandumEvent.Kind.APPROVED,
                MemorandumEvent.Kind.REJECTED,
            ],
        ).exclude(current_holder=me).distinct()

        serialize = lambda qs: MemorandumListSerializer(  # noqa: E731
            qs[:100], many=True, context=self.get_serializer_context()
        ).data
        return Response({
            "awaiting_me": serialize(awaiting),
            "mine": serialize(mine),
            "handled": serialize(handled),
        })

    # ── Transitions ──────────────────────────────────────────────────────

    def _run(self, fn, *args, **kwargs):
        try:
            memo = fn(*args, **kwargs)
        except NotYourTurn as exc:
            # Checked before its parent: "this is not with you" is a question
            # about who is asking, and the guards beside it already answer 403.
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except MemorandumError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        memo.refresh_from_db()
        return Response(self.get_serializer(memo).data)

    @action(detail=True, methods=["post"])
    def submit(self, request, *args, **kwargs):
        memo = self.get_object()
        if memo.initiator_id != getattr(self._me(), "pk", None):
            return Response(
                {"detail": "Only the initiator submits a memorandum."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return self._run(workflow.submit, memo, actor=request.user)

    @action(detail=True, methods=["post"])
    def proceed(self, request, *args, **kwargs):
        memo = self.get_object()
        action_row = MemorandumAction.objects.filter(pk=request.data.get("action")).first()
        return self._run(
            workflow.proceed,
            memo,
            self._me(),
            action=action_row,
            comment=request.data.get("comment", ""),
            actor=request.user,
        )

    @action(detail=True, methods=["post"], url_path="send-back")
    def send_back(self, request, *args, **kwargs):
        memo = self.get_object()
        target = Employee.objects.filter(pk=request.data.get("to")).first()
        action_row = MemorandumAction.objects.filter(pk=request.data.get("action")).first()
        return self._run(
            workflow.send_back,
            memo,
            self._me(),
            to=target,
            action=action_row,
            comment=request.data.get("comment", ""),
            actor=request.user,
        )

    @action(detail=True, methods=["post"])
    def resubmit(self, request, *args, **kwargs):
        memo = self.get_object()
        return self._run(
            workflow.resubmit,
            memo,
            self._me(),
            comment=request.data.get("comment", ""),
            actor=request.user,
        )

    @action(detail=True, methods=["post"])
    def skip(self, request, *args, **kwargs):
        """Move it past whoever is holding it. Initiator only — see `workflow.skip`."""
        memo = self.get_object()
        return self._run(
            workflow.skip,
            memo,
            self._me(),
            comment=request.data.get("comment", ""),
            actor=request.user,
        )

    @action(detail=True, methods=["post"])
    def archive(self, request, *args, **kwargs):
        """File it away. Initiator only — see `workflow.archive`."""
        memo = self.get_object()
        return self._run(workflow.archive, memo, self._me(), actor=request.user)

    @action(detail=True, methods=["post"])
    def approve(self, request, *args, **kwargs):
        memo = self.get_object()
        return self._run(
            workflow.decide, memo, self._me(),
            approve=True, comment=request.data.get("comment", ""), actor=request.user,
        )

    @action(detail=True, methods=["post"])
    def reject(self, request, *args, **kwargs):
        memo = self.get_object()
        return self._run(
            workflow.decide, memo, self._me(),
            approve=False, comment=request.data.get("comment", ""), actor=request.user,
        )

    @action(
        detail=True,
        methods=["post"],
        # Multipart as well as JSON: a comment may arrive with files. `JSONParser`
        # stays in the list so a plain remark is still a plain JSON post.
        parser_classes=[MultiPartParser, FormParser, JSONParser],
    )
    def comment(self, request, *args, **kwargs):
        """A remark without moving it — with, optionally, people named in it
        and files hung off it.

        Anybody who can see the memorandum can leave one — a recommender two
        steps up who spots something before it reaches them should not have to
        wait for their turn to say so.

        **Why a comment may carry files when the memorandum may not.** The
        annexes are part of the proposal and are frozen at submission, so the
        chain cannot be reading a different document from the one it signed.
        A file on a comment is the opposite thing: it is the answer to
        "attach the survey" from somebody the memorandum came back to. Refusing
        it does not keep the record clean, it sends the survey by email and
        leaves the record incomplete.

        Accepts `multipart/form-data`: `comment`, repeated `files`, and
        repeated `mention_ids`.
        """
        memo = self.get_object()
        body = (request.data.get("comment") or "").strip()
        files = request.FILES.getlist("files")
        if not body and not files:
            return Response({"detail": "Say something."}, status=status.HTTP_400_BAD_REQUEST)
        if memo.is_locked:
            return Response(
                {"detail": "This memorandum has been decided."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        mention_ids = request.data.getlist("mention_ids") if hasattr(request.data, "getlist")             else (request.data.get("mention_ids") or [])
        mentioned = list(
            Employee.objects.filter(pk__in=[int(x) for x in mention_ids if str(x).isdigit()])
        )

        event = workflow.log(
            memo, MemorandumEvent.Kind.COMMENTED,
            actor=request.user, employee=self._me(), comment=body,
        )
        if mentioned:
            event.mentions.set(mentioned)
        for upload in files:
            MemorandumAttachment.objects.create(
                memorandum=memo,
                event=event,
                file=upload,
                uploaded_by=request.user,
                created_by=request.user,
                updated_by=request.user,
            )
        workflow.tell_mentioned(memo, event, mentioned, actor=request.user)

        memo.refresh_from_db()
        return Response(self.get_serializer(memo).data)

    # ── Attachments ──────────────────────────────────────────────────────

    @action(
        detail=True,
        methods=["get", "post"],
        parser_classes=[MultiPartParser, FormParser],
    )
    def attachments(self, request, *args, **kwargs):
        memo = self.get_object()
        if request.method == "GET":
            return Response(
                MemorandumAttachmentSerializer(memo.attachments.all(), many=True).data
            )
        me = self._me()
        # Fixed at submission, like everything else that is not the content: a
        # chain reading three annexes must not find a fourth appear beneath
        # their comments.
        if memo.status != Memorandum.Status.DRAFT:
            return Response(
                {"detail": "Attachments are fixed once the memorandum is submitted."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if memo.initiator_id != getattr(me, "pk", None):
            return Response(
                {"detail": "Only the initiator attaches to their memorandum."},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = MemorandumAttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(
            memorandum=memo,
            uploaded_by=request.user,
            created_by=request.user,
            updated_by=request.user,
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"attachments/(?P<attachment_id>[0-9]+)")
    def attachment_detail(self, request, attachment_id=None, *args, **kwargs):
        memo = self.get_object()
        if memo.status != Memorandum.Status.DRAFT:
            return Response(
                {"detail": "Attachments are fixed once the memorandum is submitted."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if memo.initiator_id != getattr(self._me(), "pk", None):
            return Response(status=status.HTTP_403_FORBIDDEN)
        row = memo.attachments.filter(pk=attachment_id).first()
        if row is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        row.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
