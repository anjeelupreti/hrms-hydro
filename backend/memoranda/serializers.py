from rest_framework import serializers

from memoranda.models import (
    Memorandum,
    MemorandumAction,
    MemorandumAttachment,
    MemorandumEvent,
    MemorandumRecommender,
)
from memoranda.sanitize import clean_html


def _name(employee):
    if employee is None:
        return None
    user = employee.user
    return user.get_full_name() or user.get_username()


def _code(employee):
    """The employee ID, for putting beside a name.

    A memorandum is signed by people whose names repeat — two Sitas in accounts,
    three Gurungs on the site team — and once it is printed and filed there is
    nothing else on the page to tell them apart. The ID is the part that is
    unique, so it travels with the name.
    """
    return getattr(employee, "employee_code", "") or ""


def _signature(employee, request=None):
    """The employee's approved signature image, or None.

    **Approved only.** A pending upload is a picture somebody sent in; printing
    it under a recommendation would put an unchecked signature on a document
    that is meant to be the record of who signed it. There is at most one
    approved row per person — a partial unique index guarantees it — so this
    cannot silently pick between two.
    """
    row = employee.signatures.filter(status="approved").first() if employee else None
    if row is None or not row.image:
        return None
    return request.build_absolute_uri(row.image.url) if request else row.image.url


def _post(employee):
    """The office somebody holds, for a To or From line.

    The corporate post first, then the designation. A memorandum is addressed
    to a chair — "Deputy Manager" — and only falls back to the job title when
    no post has been recorded. Empty rather than null: it is concatenated into
    a line, and "None" appearing on a letter is worse than nothing appearing.
    """
    if employee is None:
        return ""
    post = getattr(employee, "corporate_post", None)
    if post is not None:
        return post.name
    designation = getattr(employee, "designation", None)
    return designation.title if designation is not None else ""


class MemorandumActionSerializer(serializers.ModelSerializer):
    """The configurable vocabulary — see `MemorandumAction`."""

    effect_display = serializers.CharField(source="get_effect_display", read_only=True)

    class Meta:
        model = MemorandumAction
        fields = [
            "id", "name", "code", "effect", "effect_display",
            "description", "order", "is_active", "for_approver",
        ]


class MemorandumRecommenderSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    designation = serializers.CharField(
        source="employee.designation.title", read_only=True, default=None
    )
    #: Whether this person has handled the memo at any point. Read from the log
    #: — see `workflow.has_ever_acted` — and the reason the chip is locked in
    #: the editor rather than merely refused on save.
    has_acted = serializers.SerializerMethodField()
    is_current = serializers.SerializerMethodField()
    #: Their approved signature, and **only once they have actually acted.**
    #: Printing it beside a name that has not recommended anything yet would
    #: put a signature on a document nobody has signed.
    signature = serializers.SerializerMethodField()

    class Meta:
        model = MemorandumRecommender
        fields = [
            "id", "employee", "employee_name", "employee_code",
            "designation", "order", "has_acted", "is_current", "signature",
        ]

    def get_signature(self, obj):
        from memoranda.workflow import has_ever_acted

        if not has_ever_acted(obj.memorandum, obj.employee):
            return None
        return _signature(obj.employee, self.context.get("request"))

    def get_employee_name(self, obj):
        return _name(obj.employee)

    def get_has_acted(self, obj):
        from memoranda.workflow import has_ever_acted

        return has_ever_acted(obj.memorandum, obj.employee)

    def get_is_current(self, obj):
        return obj.memorandum.current_holder_id == obj.employee_id


class MemorandumAttachmentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = MemorandumAttachment
        fields = [
            "id", "memorandum", "event", "file", "file_url", "caption",
            "uploaded_by_name", "created_at",
        ]
        read_only_fields = ["memorandum", "event", "created_at"]

    def get_file_url(self, obj):
        return obj.file.url if obj.file else None

    def get_uploaded_by_name(self, obj):
        if obj.uploaded_by is None:
            return None
        return obj.uploaded_by.get_full_name() or obj.uploaded_by.get_username()


class MemorandumEventSerializer(serializers.ModelSerializer):
    """One line of the history. Every field is frozen at write time."""

    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    returned_to_name = serializers.SerializerMethodField()
    #: Who the comment named, and what came attached to it. Served with the
    #: line rather than fetched per comment: the history is drawn in one pass
    #: and a request per row would be a query storm on a long memorandum.
    mentions = serializers.SerializerMethodField()
    attachments = MemorandumAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = MemorandumEvent
        fields = [
            "id", "kind", "kind_display", "actor_label", "role",
            "action", "action_label", "comment", "mentions", "attachments",
            "returned_to", "returned_to_name", "created_at",
        ]

    def get_returned_to_name(self, obj):
        return _name(obj.returned_to)

    def get_mentions(self, obj):
        return [
            {"id": e.pk, "name": _name(e), "employee_code": e.employee_code}
            for e in obj.mentions.all()
        ]


class MemorandumListSerializer(serializers.ModelSerializer):
    """The shape every list on the page reads.

    Carries who holds it and what it is waiting for, because that is what each
    of the three sections is sorted and filtered by — and not the content or
    the chain, which a list never shows.
    """

    company_name = serializers.CharField(source="company.name", read_only=True)
    company_code = serializers.CharField(source="company.code", read_only=True)
    #: The seat, for the letterhead. A memorandum is printed and filed, and a
    #: letterhead with no address on it is not one.
    company_address = serializers.SerializerMethodField()
    #: The mark at the top of the page. A letterhead without one is a typed
    #: sheet, not a letterhead — and every company here has a logo field
    #: precisely so its paper looks like its paper.
    company_logo = serializers.SerializerMethodField()
    #: The line under the address: registration and PAN, which is what a
    #: Nepali company's letterhead carries and what anybody filing the printout
    #: needs off the page.
    company_registration = serializers.CharField(
        source="company.registration_number", read_only=True, default=""
    )
    company_pan = serializers.CharField(
        source="company.pan_vat_number", read_only=True, default=""
    )
    company_phone = serializers.CharField(source="company.phone", read_only=True, default="")
    company_email = serializers.CharField(source="company.email", read_only=True, default="")
    initiator_name = serializers.SerializerMethodField()
    approver_name = serializers.SerializerMethodField()
    #: Post held, for the To and From lines. A memorandum addresses an office
    #: as much as a person — "Kabita Thapa, Plant Manager" is how one is
    #: actually written, and a bare name reads like a chat message.
    initiator_post = serializers.SerializerMethodField()
    approver_post = serializers.SerializerMethodField()
    current_holder_name = serializers.SerializerMethodField()
    initiator_code = serializers.SerializerMethodField()
    approver_code = serializers.SerializerMethodField()
    current_holder_code = serializers.SerializerMethodField()
    initiator_signature = serializers.SerializerMethodField()
    approver_signature = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    stage_display = serializers.CharField(source="get_stage_display", read_only=True)
    attachment_count = serializers.IntegerField(read_only=True)
    recommender_count = serializers.IntegerField(read_only=True)
    is_locked = serializers.BooleanField(read_only=True)

    class Meta:
        model = Memorandum
        fields = [
            "id", "memo_id", "subject", "memo_date",
            "company", "company_name", "company_code", "company_address",
            "company_logo", "company_registration", "company_pan",
            "company_phone", "company_email",
            "status", "status_display", "stage", "stage_display",
            "initiator", "initiator_name", "initiator_post", "initiator_code",
            "initiator_signature",
            "approver", "approver_name", "approver_post", "approver_code",
            "approver_signature",
            "current_holder", "current_holder_name", "current_holder_code", "current_index",
            "attachment_count", "recommender_count", "is_locked",
            "submitted_at", "decided_at", "created_at",
        ]

    def get_initiator_name(self, obj):
        return _name(obj.initiator)

    def get_approver_name(self, obj):
        return _name(obj.approver)

    def get_company_logo(self, obj):
        """An absolute URL when there is a request to build one from.

        Relative otherwise, which is what a management command or a task gets —
        those never render a letterhead, so a path they cannot resolve costs
        nothing, and raising instead would break them for no gain.
        """
        logo = getattr(obj.company, "logo", None)
        if not logo:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(logo.url) if request else logo.url

    def get_company_address(self, obj):
        company = obj.company
        if company is None:
            return ""
        # Assembled without repeating itself: `address` is free text and
        # usually already carries the district.
        parts = []
        for part in (company.address, company.district, company.province):
            if part and part.lower() not in ", ".join(parts).lower():
                parts.append(part)
        return ", ".join(parts)

    def get_initiator_post(self, obj):
        return _post(obj.initiator)

    def get_approver_post(self, obj):
        return _post(obj.approver)

    def get_current_holder_name(self, obj):
        return _name(obj.current_holder)

    def get_initiator_code(self, obj):
        return _code(obj.initiator)

    def get_approver_code(self, obj):
        return _code(obj.approver)

    def get_current_holder_code(self, obj):
        return _code(obj.current_holder)

    def get_initiator_signature(self, obj):
        """**Once it has been sent, not before.** A draft is a piece of writing;
        signing it while it is still being edited would mean the signature sat
        on a document that then changed underneath it."""
        if obj.status == Memorandum.Status.DRAFT:
            return None
        return _signature(obj.initiator, self.context.get("request"))

    def get_approver_signature(self, obj):
        """Only once they have decided. The approver's signature is the
        decision — printing it while the memorandum is still climbing the chain
        would say it had been approved when it has not."""
        if obj.status != Memorandum.Status.APPROVED:
            return None
        return _signature(obj.approver, self.context.get("request"))


class MemorandumSerializer(MemorandumListSerializer):
    """The whole thing.

    `recommender_ids` is write-only and ordered: the chain is what the initiator
    drew, so it is sent as a list rather than as a set of rows with their own
    endpoints — reordering by PATCHing four `order` fields is four requests
    that can half-succeed.
    """

    recommenders = MemorandumRecommenderSerializer(many=True, read_only=True)
    #: The memorandum's own annexes — the ones with no comment behind them.
    #: A file that arrived on a comment belongs to that comment and is served
    #: with it; listing it here as well would show it twice and imply it was
    #: part of the proposal the chain signed, which is the one thing the
    #: freeze-at-submission rule exists to prevent.
    attachments = serializers.SerializerMethodField()
    events = MemorandumEventSerializer(many=True, read_only=True)
    recommender_ids = serializers.ListField(
        child=serializers.IntegerField(), write_only=True, required=False
    )
    #: What the person reading it may do to it right now. Computed server-side
    #: because the rules are the workflow's — a browser deciding for itself
    #: whether a button belongs is a second copy of them.
    my_role = serializers.SerializerMethodField()
    can_act = serializers.SerializerMethodField()
    can_edit_content = serializers.SerializerMethodField()
    can_edit_chain = serializers.SerializerMethodField()
    return_targets = serializers.SerializerMethodField()

    class Meta(MemorandumListSerializer.Meta):
        fields = MemorandumListSerializer.Meta.fields + [
            "content", "serial_number",
            "recommenders", "recommender_ids", "attachments", "events",
            "my_role", "can_act", "can_edit_content", "can_edit_chain", "return_targets",
            "updated_at",
        ]
        read_only_fields = [
            # Everything the workflow owns. A memorandum that could have its
            # status PATCHed would have two ways to move and only one of them
            # would write a log entry.
            "memo_id", "serial_number", "status", "stage",
            "current_holder", "current_index", "initiator",
            "submitted_at", "decided_at", "created_at", "updated_at",
        ]

    # ── What the reader may do ───────────────────────────────────────────

    def _me(self):
        request = self.context.get("request")
        return getattr(getattr(request, "user", None), "employee", None)

    def get_attachments(self, obj):
        annexes = [a for a in obj.attachments.all() if a.event_id is None]
        return MemorandumAttachmentSerializer(annexes, many=True, context=self.context).data

    def get_my_role(self, obj):
        from memoranda.workflow import _role_of

        return _role_of(obj, self._me())

    def get_can_act(self, obj):
        me = self._me()
        return bool(me and not obj.is_locked and obj.current_holder_id == me.pk)

    def get_can_edit_content(self, obj):
        """The one field that survives submission — while it is on their desk.

        See `workflow.may_write`. The browser draws its editor from this, and
        the same function guards the write, so the two cannot drift.
        """
        from memoranda.workflow import may_write

        return may_write(obj, self._me())

    def get_can_edit_chain(self, obj):
        """Who signs it stays the initiator's, wherever it currently sits.

        Deliberately *not* the `may_write` rule that governs the text. A
        recommender goes on leave, or is off site with no signal, and the memo
        stops dead on their desk — the initiator has to be able to take them
        out of the chain or move somebody ahead of them without waiting for the
        person who is absent. `set_chain` already refuses the two changes that
        would rewrite history: somebody who has acted cannot be removed, and
        neither can the person holding it right now. Skipping *that* person is
        `skip`, which is an act with a name and a log line rather than a quiet
        edit.
        """
        me = self._me()
        return bool(me and not obj.is_locked and obj.initiator_id == me.pk)

    def get_return_targets(self, obj):
        from memoranda.workflow import eligible_return_targets

        if not self.get_can_act(obj):
            return []
        return [
            {"id": e.pk, "name": _name(e), "is_initiator": e.pk == obj.initiator_id}
            for e in eligible_return_targets(obj)
        ]

    # ── Writing ──────────────────────────────────────────────────────────

    def validate_content(self, value):
        # Sanitised on the way in rather than on the way out, so what is stored
        # is what is safe. Escaping at render time means every future template
        # has to remember; this way the database cannot hold a payload at all.
        return clean_html(value)

    def validate(self, attrs):
        """Refuse a write that the memorandum's state does not allow.

        The rules live here as well as in `workflow` because the two are
        reached differently — an action goes through the workflow, and a plain
        `PATCH` comes straight here. Stated in one place would be better; stated
        in neither is how an approved memorandum gets edited.
        """
        instance = self.instance
        if instance is None:
            return attrs

        if instance.is_locked:
            raise serializers.ValidationError(
                "This memorandum has been decided. It is a record now and cannot be changed."
            )

        if instance.status != Memorandum.Status.DRAFT:
            # In flight: the text may be corrected, and nothing else. The chain
            # has been reading the rest, and changing it beneath their comments
            # would make every one of them a comment on a different document.
            #
            # `company` is deliberately *not* frozen. It is the middle segment
            # of the reference, and a memorandum filed under the wrong company
            # of a four-company group is wrong in the register as well as on the
            # page — so the initiator can move it, and `workflow.set_company`
            # re-mints the number to match. `perform_update` still only lets
            # them do it while it is on their own desk.
            frozen = {"memo_date", "subject"}
            changed = frozen.intersection(attrs)
            if changed:
                names = ", ".join(sorted(changed))
                raise serializers.ValidationError(
                    f"Once submitted, only the content can be changed — not {names}."
                )
        return attrs
