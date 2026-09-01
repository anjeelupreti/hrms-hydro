from datetime import date
from decimal import Decimal

from django.contrib.contenttypes.models import ContentType
from django.db.models import DecimalField, ExpressionWrapper, F, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from django_filters import rest_framework as django_filters
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.counts import StatusCountsMixin
from core.exports import XlsxExportMixin
from core.filters import IdsLookupMixin
from core.statusflow import TICKET_FLOW
from core.timeline import timeline_for
from core.viewsets import AuditViewSetMixin
from crm.models import (
    Activity,
    Client,
    ClientTicket,
    Contact,
    Deal,
    Invoice,
    TimelineEntry,
)
from crm.serializers import (
    ActivitySerializer,
    ClientSerializer,
    ClientTicketSerializer,
    ContactSerializer,
    DealSerializer,
    InvoiceSerializer,
    TimelineEntrySerializer,
)
from crm.tickets import (
    TicketError,
    add_internal_note,
    assign_ticket,
    move_ticket,
    raise_ticket,
    reply_to_client,
)

# Any authenticated company user can create/edit CRM records — unlike most
# config in this codebase, CRM ownership doesn't map onto the existing
# hr_admin/employee role split, so writes are deliberately left open
# rather than forcing a role distinction that doesn't fit yet.
PERMISSION_CLASSES = [IsAuthenticated]


class ClientViewSet(IdsLookupMixin, XlsxExportMixin, AuditViewSetMixin, ModelViewSet):
    queryset = Client.objects.all()
    serializer_class = ClientSerializer
    permission_classes = PERMISSION_CLASSES
    filter_backends = [django_filters.DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["status"]
    search_fields = ["name", "industry"]

    export_filename = "clients.xlsx"
    export_title = "Clients"
    export_headers = ["Name", "Industry", "Status", "Website"]

    def get_export_rows(self, queryset):
        return [[c.name, c.industry, c.get_status_display(), c.website] for c in queryset]

    @action(detail=False, methods=["get"], url_path="book-summary")
    def book_summary(self, request, *args, **kwargs):
        """What the client list is worth, and what is owed on it.

        A client list is names and industries. It cannot say which of them are
        actually worth something, and the answer is not in the `Client` table at
        all — it is in the deals and invoices hanging off it. Every other list
        in this module gained a reading; this one is the last, and it is the one
        the other three roll up into.

        **Two figures, because they are two different conversations.** Won
        business is what the relationship has been worth; unpaid invoices past
        their date are a phone call to make this week. Averaging them into one
        "client value" would hide the second inside the first.

        Invoice totals are derived from line items and never stored — the same
        expression `InvoiceViewSet` sums, reused rather than re-derived, so the
        two screens cannot disagree about what an invoice is worth.
        """
        line_total = ExpressionWrapper(
            F("line_items__quantity") * F("line_items__unit_price"),
            output_field=DecimalField(max_digits=14, decimal_places=2),
        )

        clients = self.get_queryset()
        active = clients.filter(status=Client.Status.ACTIVE).count()

        deals = Deal.objects.filter(client__in=clients)
        won = deals.filter(stage=Deal.Stage.WON).aggregate(total=Sum("value"))["total"] or Decimal("0")
        open_stages = [Deal.Stage.LEAD, Deal.Stage.QUALIFIED, Deal.Stage.PROPOSAL]
        in_play = deals.filter(stage__in=open_stages)

        # Sent and not paid. A draft has not been asked for yet, and a void one
        # was withdrawn — neither is money anybody is waiting on.
        unpaid = Invoice.objects.filter(client__in=clients, status=Invoice.Status.SENT)
        outstanding = unpaid.aggregate(total=Sum(line_total))["total"] or Decimal("0")
        overdue = unpaid.filter(due_date__lt=date.today())
        overdue_total = overdue.aggregate(total=Sum(line_total))["total"] or Decimal("0")

        return Response(
            {
                "clients_total": clients.count(),
                "clients_active": active,
                "won_value": str(won),
                "open_value": str(in_play.aggregate(total=Sum("value"))["total"] or Decimal("0")),
                "open_deals": in_play.count(),
                "outstanding": str(outstanding),
                "overdue": str(overdue_total),
                "overdue_invoices": overdue.count(),
                # Clients with something unresolved on the desk. Service load is
                # the third thing an account manager is judged on and the client
                # list said nothing about it.
                "clients_with_open_tickets": (
                    ClientTicket.objects.filter(client__in=clients)
                    .exclude(status__in=["resolved", "closed"])
                    .values("client")
                    .distinct()
                    .count()
                ),
            }
        )


class ContactViewSet(AuditViewSetMixin, ModelViewSet):
    serializer_class = ContactSerializer
    permission_classes = PERMISSION_CLASSES
    filter_backends = [django_filters.DjangoFilterBackend]
    filterset_fields = ["client"]

    def get_queryset(self):
        return Contact.objects.select_related("client")


class DealViewSet(StatusCountsMixin, XlsxExportMixin, AuditViewSetMixin, ModelViewSet):
    serializer_class = DealSerializer
    permission_classes = PERMISSION_CLASSES
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_fields = ["client", "stage", "owner"]
    search_fields = ["title", "client__name"]
    ordering_fields = ["value", "expected_close_date", "created_at", "title"]
    ordering = ["-created_at"]
    # A pipeline is read as "how much is sitting in Proposal", not "how many
    # rows" — the stage counts are worthless here without the money beside them.
    count_field = "stage"
    sum_field = "value"

    export_filename = "deals.xlsx"
    export_title = "Deals"
    export_headers = ["Title", "Client", "Stage", "Value", "Owner", "Expected close"]
    export_highlight_header = "Stage"
    export_validations = {"Stage": ["Lead", "Qualified", "Proposal", "Won", "Lost"]}

    def get_export_rows(self, queryset):
        return [
            [
                d.title,
                d.client.name if d.client else "",
                d.get_stage_display(),
                str(d.value),
                (d.owner.user.get_full_name() or d.owner.user.get_username()) if d.owner else "",
                d.expected_close_date.isoformat() if d.expected_close_date else "",
            ]
            for d in queryset
        ]

    def get_queryset(self):
        return Deal.objects.select_related("client", "owner__user")


class InvoiceViewSet(StatusCountsMixin, AuditViewSetMixin, ModelViewSet):
    serializer_class = InvoiceSerializer
    permission_classes = PERMISSION_CLASSES
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_fields = ["client", "status", "project"]
    search_fields = ["number", "client__name", "project__name"]
    # `total` is annotated below, not stored — ordering and summing both need
    # it in SQL, and the model's `total` is a Python property that sums
    # prefetched line items. Naming it here without the annotation would raise
    # only when somebody actually sorted by it.
    ordering_fields = ["issue_date", "due_date", "invoice_total", "number"]
    ordering = ["-issue_date"]
    # "Overdue: 4" means nothing without "worth 812,000".
    sum_field = ExpressionWrapper(
        F("line_items__quantity") * F("line_items__unit_price"),
        output_field=DecimalField(max_digits=14, decimal_places=2),
    )

    def get_queryset(self):
        qs = Invoice.objects.select_related("client", "project").prefetch_related("line_items")
        if self.action == "status_counts":
            # Deliberately *not* annotated here. `status-counts` groups by
            # status and sums `sum_field`, and summing a per-row annotation
            # that is itself a Sum raises "cannot compute Sum(...): it is an
            # aggregate". The mixin sums the line-item product directly
            # instead, which groups correctly over the same join.
            return qs
        # Sum in the database rather than per row: the model's `total` walks
        # `line_items` for each invoice, which is fine for one detail view and
        # an N+1 across a list — and cannot be sorted by at all.
        return qs.annotate(
            invoice_total=Coalesce(
                Sum(F("line_items__quantity") * F("line_items__unit_price")),
                Value(Decimal("0")),
                output_field=DecimalField(max_digits=14, decimal_places=2),
            )
        )

    def _set_status(self, request, new_status):
        invoice = self.get_object()
        invoice.status = new_status
        invoice.updated_by = request.user
        invoice.save(update_fields=["status", "updated_by", "updated_at"])
        return Response(self.get_serializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="mark-sent")
    def mark_sent(self, request, **kwargs):
        return self._set_status(request, Invoice.Status.SENT)

    @action(detail=True, methods=["post"], url_path="mark-paid")
    def mark_paid(self, request, **kwargs):
        return self._set_status(request, Invoice.Status.PAID)

    @action(detail=True, methods=["post"])
    def void(self, request, **kwargs):
        return self._set_status(request, Invoice.Status.VOID)


class ActivityViewSet(AuditViewSetMixin, ModelViewSet):
    serializer_class = ActivitySerializer
    permission_classes = PERMISSION_CLASSES

    def get_queryset(self):
        qs = Activity.objects.select_related("content_type")
        for model_name, model in (("client", Client), ("contact", Contact), ("deal", Deal)):
            object_id = self.request.query_params.get(model_name)
            if object_id:
                qs = qs.filter(content_type=ContentType.objects.get_for_model(model), object_id=object_id)
        return qs


class ClientTicketViewSet(StatusCountsMixin, AuditViewSetMixin, ModelViewSet):
    """The client desk — customers' concerns, beside their record.

    Distinct from `helpdesk`, which is the internal staff queue. Two inbound
    queues per company, deliberately: a customer's complaint must never surface
    in the IT queue, and the audiences and privacy rules differ.
    """

    serializer_class = ClientTicketSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_fields = ["status", "priority", "client", "assignee", "channel"]
    search_fields = ["reference", "subject", "description", "client__name"]
    ordering_fields = ["created_at", "priority", "status", "reference"]
    # Oldest-waiting first is the queue's own order: a desk is worked from the
    # top, and the row that has waited longest is the one that should be there.
    ordering = ["created_at"]

    def get_queryset(self):
        return ClientTicket.objects.select_related("client", "contact", "assignee__user")

    def get_count_choices(self):
        """The buckets, read from `TICKET_FLOW` rather than from field choices.

        `StatusCountsMixin` normally takes them from the column's `choices`, and
        this model deliberately has none: a ticket's legal states and the moves
        between them live in the flow, so that "resolved while waiting on the
        customer" can be refused rather than merely discouraged. The flow is
        therefore the one place that knows.
        """
        return [state for state, _ in TICKET_FLOW.states]

    @action(detail=False, methods=["get"], url_path="desk-summary")
    def desk_summary(self, request, *args, **kwargs):
        """What the desk is failing at, not how much it holds.

        A client ticket carries two promises — somebody will *look* at this, and
        somebody will *fix* it — and the model already snapshots a due time for
        each. The reading worth the space above the list is therefore how many
        of those promises are currently broken, which no page of rows can show.

        The breach tests are the same comparisons as `response_breached` and
        `resolution_breached`, written as queryset filters: those are Python
        properties, and evaluating them row by row would read the whole table to
        count it (§2.6 — derive from the server, over everything, not from the
        hundred rows on screen).
        """
        now = timezone.now()
        queryset = self.get_queryset()
        live = queryset.exclude(status__in=["resolved", "closed"])

        # Not yet replied to, and the clock has already run out.
        response_breaches = live.filter(
            first_response_at__isnull=True,
            response_due_at__isnull=False,
            response_due_at__lt=now,
        ).count()
        resolution_breaches = live.filter(
            resolution_due_at__isnull=False, resolution_due_at__lt=now
        ).count()

        oldest = live.order_by("created_at").values_list("created_at", flat=True).first()

        return Response(
            {
                "live": live.count(),
                "awaiting_first_reply": live.filter(first_response_at__isnull=True).count(),
                "response_breaches": response_breaches,
                "resolution_breaches": resolution_breaches,
                "unassigned": live.filter(assignee__isnull=True).count(),
                "oldest_open_days": (now - oldest).days if oldest else None,
            }
        )

    def create(self, request, *args, **kwargs):
        """Raise through the service, so the SLA clocks are set.

        Creating the row directly would leave `response_due_at` null and the
        ticket permanently un-breachable — a queue where nothing is ever late.
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        ticket = raise_ticket(
            client=data["client"],
            subject=data["subject"],
            description=data.get("description", ""),
            contact=data.get("contact"),
            priority=data.get("priority", ClientTicket.Priority.NORMAL),
            channel=data.get("channel", ClientTicket.Channel.INTERNAL),
            actor=request.user,
        )
        return Response(self.get_serializer(ticket).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"])
    def board(self, request, *args, **kwargs):
        """Columns and cards for the kanban, from the declared flow.

        Columns come from `TICKET_FLOW` rather than from whatever statuses
        happen to be present: an empty column is information — nothing is
        waiting on the customer — and deriving columns from the data would make
        it vanish exactly when that is worth knowing.
        """
        tickets = self.filter_queryset(self.get_queryset())
        by_status = {}
        for ticket in tickets:
            by_status.setdefault(ticket.status, []).append(ticket)

        return Response({
            "columns": [
                {
                    **column,
                    "count": len(by_status.get(column["value"], [])),
                    "cards": ClientTicketSerializer(
                        by_status.get(column["value"], []), many=True
                    ).data,
                }
                for column in TICKET_FLOW.columns()
            ],
            # The legal moves, so the board can refuse a drag before asking the
            # server — and say why rather than just snapping the card back.
            "transitions": {
                state: sorted(TICKET_FLOW.transitions.get(state, set()))
                for state in TICKET_FLOW.values
            },
        })

    @action(detail=True, methods=["post"])
    def move(self, request, *args, **kwargs):
        ticket = self.get_object()
        try:
            move_ticket(
                ticket,
                request.data.get("status", ""),
                actor=request.user,
                note=(request.data.get("note") or "").strip(),
            )
        except TicketError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        ticket.refresh_from_db()
        return Response(self.get_serializer(ticket).data)

    @action(detail=True, methods=["post"])
    def assign(self, request, *args, **kwargs):
        from employees.models import Employee

        ticket = self.get_object()
        employee_id = request.data.get("employee")
        employee = None
        if employee_id:
            employee = Employee.objects.filter(pk=employee_id).first()
            if employee is None:
                return Response({"detail": "No such employee."}, status=status.HTTP_400_BAD_REQUEST)
        assign_ticket(ticket, employee, actor=request.user)
        ticket.refresh_from_db()
        return Response(self.get_serializer(ticket).data)

    @action(detail=True, methods=["post"])
    def reply(self, request, *args, **kwargs):
        """A reply the client receives — and the thing that stops the clock."""
        ticket = self.get_object()
        try:
            reply_to_client(ticket, request.data.get("body", ""), actor=request.user)
        except TicketError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        ticket.refresh_from_db()
        return Response(self.get_serializer(ticket).data)

    @action(detail=True, methods=["post"], url_path="note")
    def note(self, request, *args, **kwargs):
        """An internal note. Explicitly does not stop the response clock."""
        body = (request.data.get("body") or "").strip()
        if not body:
            return Response(
                {"detail": "A note needs something in it."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        add_internal_note(self.get_object(), body, actor=request.user)
        return Response({"ok": True}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def timeline(self, request, *args, **kwargs):
        """The full history, internal notes included — staff-facing.

        The client-visible subset is `client_visible_timeline`, which is what a
        customer portal would call.
        """
        entries = timeline_for(TimelineEntry, self.get_object())
        return Response(TimelineEntrySerializer(entries, many=True).data)
