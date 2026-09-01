from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from crm.models import (
    Activity,
    Client,
    ClientTicket,
    Contact,
    Deal,
    Invoice,
    InvoiceLineItem,
    TimelineEntry,
)


class ClientSerializer(serializers.ModelSerializer):
    class Meta:
        model = Client
        fields = ["id", "name", "industry", "website", "address", "notes", "status"]


class ContactSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.name", read_only=True)

    class Meta:
        model = Contact
        fields = ["id", "client", "client_name", "name", "title", "email", "phone"]


class DealSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.name", read_only=True)
    owner_name = serializers.SerializerMethodField()

    class Meta:
        model = Deal
        fields = [
            "id",
            "client",
            "client_name",
            "title",
            "stage",
            "value",
            "expected_close_date",
            "owner",
            "owner_name",
        ]

    def get_owner_name(self, obj):
        if obj.owner is None:
            return None
        return obj.owner.user.get_full_name() or obj.owner.user.get_username()


class InvoiceLineItemSerializer(serializers.ModelSerializer):
    amount = serializers.SerializerMethodField()

    class Meta:
        model = InvoiceLineItem
        fields = ["id", "description", "quantity", "unit_price", "order", "amount"]

    def get_amount(self, obj):
        return obj.amount


class InvoiceSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.name", read_only=True)
    line_items = InvoiceLineItemSerializer(many=True)
    total = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = [
            "id",
            "client",
            "client_name",
            "project",
            "number",
            "issue_date",
            "due_date",
            "status",
            "currency",
            "notes",
            "line_items",
            "total",
        ]
        read_only_fields = ["number", "status"]

    def get_total(self, obj):
        return obj.total

    def _write_line_items(self, invoice, items):
        invoice.line_items.all().delete()
        InvoiceLineItem.objects.bulk_create(
            InvoiceLineItem(
                invoice=invoice,
                description=it.get("description", ""),
                quantity=it.get("quantity", 1),
                unit_price=it.get("unit_price", 0),
                order=idx,
            )
            for idx, it in enumerate(items)
        )

    def create(self, validated_data):
        items = validated_data.pop("line_items", [])
        # Sequential invoice number, zero-padded per company.
        seq = Invoice.objects.count() + 1
        validated_data["number"] = f"INV-{seq:05d}"
        invoice = Invoice.objects.create(**validated_data)
        self._write_line_items(invoice, items)
        return invoice

    def update(self, instance, validated_data):
        items = validated_data.pop("line_items", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items is not None:
            self._write_line_items(instance, items)
        return instance


class ActivitySerializer(serializers.ModelSerializer):
    """Write accepts exactly one of `client`/`contact`/`deal` (resolved
    into content_type/object_id); read exposes the same three back as
    plain FK ids so the frontend never has to know about ContentType."""

    client = serializers.IntegerField(write_only=True, required=False)
    contact = serializers.IntegerField(write_only=True, required=False)
    deal = serializers.IntegerField(write_only=True, required=False)

    related_type = serializers.SerializerMethodField()
    related_id = serializers.SerializerMethodField()
    related_label = serializers.SerializerMethodField()

    class Meta:
        model = Activity
        fields = [
            "id",
            "activity_type",
            "notes",
            "occurred_at",
            "client",
            "contact",
            "deal",
            "related_type",
            "related_id",
            "related_label",
        ]

    def validate(self, attrs):
        targets = {k: attrs.pop(k) for k in ("client", "contact", "deal") if k in attrs}
        if self.instance is None and len(targets) != 1:
            raise serializers.ValidationError("Provide exactly one of client, contact, or deal.")
        if targets:
            model_name, object_id = next(iter(targets.items()))
            model = {"client": Client, "contact": Contact, "deal": Deal}[model_name]
            if not model.objects.filter(pk=object_id).exists():
                raise serializers.ValidationError({model_name: "Not found."})
            attrs["content_type"] = ContentType.objects.get_for_model(model)
            attrs["object_id"] = object_id
        return attrs

    def get_related_type(self, obj):
        return obj.content_type.model

    def get_related_id(self, obj):
        return obj.object_id

    def get_related_label(self, obj):
        target = obj.related_object
        return str(target) if target else None


class ClientTicketSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.name", read_only=True)
    contact_name = serializers.CharField(source="contact.name", read_only=True, default=None)
    assignee_name = serializers.SerializerMethodField()
    response_breached = serializers.BooleanField(read_only=True)
    resolution_breached = serializers.BooleanField(read_only=True)
    age_hours = serializers.SerializerMethodField()

    class Meta:
        model = ClientTicket
        fields = [
            "id", "reference", "client", "client_name", "contact", "contact_name",
            "subject", "description", "priority", "channel", "status",
            "assignee", "assignee_name",
            "first_response_at", "resolved_at",
            "response_due_at", "resolution_due_at",
            "response_breached", "resolution_breached", "age_hours",
            "created_at",
        ]
        # Status moves only through the declared flow, and the clocks are set by
        # the acts that stop them. A PATCH could otherwise mark a ticket
        # resolved with nobody having resolved anything.
        read_only_fields = [
            "id", "reference", "status", "assignee",
            "first_response_at", "resolved_at",
            "response_due_at", "resolution_due_at", "created_at",
        ]

    def get_assignee_name(self, obj):
        if obj.assignee is None:
            return None
        user = obj.assignee.user
        return user.get_full_name() or user.get_username()

    def get_age_hours(self, obj):
        """How old this is, in hours.

        A queue is read by age far more than by date — "open four days" is the
        thing that makes somebody act, and a timestamp makes the reader do the
        subtraction themselves.
        """
        from django.utils import timezone

        return round((timezone.now() - obj.created_at).total_seconds() / 3600, 1)


class TimelineEntrySerializer(serializers.ModelSerializer):
    who = serializers.CharField(read_only=True)

    class Meta:
        model = TimelineEntry
        fields = ["id", "kind", "visibility", "body", "from_value", "to_value", "who", "created_at"]
        read_only_fields = fields
