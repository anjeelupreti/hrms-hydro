"""Memoranda — the note that travels up the office and comes back signed.

**What this actually is.** In a Nepali hydropower company (and in the public
bodies these companies deal with) almost nothing is decided by an email. A
proposal is written as a memorandum, it is *recommended* by one person after
another up a chain each of whom writes a line, and it is finally *approved* or
*rejected* by one person who can. The document, the chain and the comments are
the record; the decision is only meaningful because they exist.

Three properties fall out of that, and every design choice below serves one of
them.

**1. The chain is ordered, and it is the initiator's to draw.** Not a role
hierarchy, not the reporting line — the person raising the memo names who has
to see it and in what order, because that order is itself part of the proposal.
A memo about a tailrace variation goes to the site engineer before the chief
engineer; a memo about a payment goes to accounts first. So the chain is rows
with an `order`, and `current_index` says how far up it has got.

**2. Returning is normal, and it is not rejection.** Anybody holding the memo
can send it back — to the initiator, or to anybody who has already handled it —
with a comment saying what is wrong. It is then corrected and comes forward
again *from the point it was returned to*, through the same people. That loop
can run any number of times. Only the approver ends it.

**3. After approval nothing changes, ever.** A memo is evidence: an auditor
reads it a year later and has to be looking at what was actually approved.
`is_locked` is checked on every write path, not merely hidden in the UI.

**Why not `LifecycleEvent` or `checklists`.** Both are approval-shaped and
neither fits. A lifecycle event has one decision and a fixed subject (an
employee); a checklist is a set of tasks with no order between people and no
concept of sending work backwards. What is different here is the *chain with a
cursor that can move both ways*, and that is the whole module.
"""

from django.conf import settings
from django.db import models

from core.models import AuditModel


def memo_attachment_path(instance, filename):
    return f"memoranda/{instance.memorandum_id or 'new'}/{filename}"


class MemorandumAction(AuditModel):
    """A word somebody can put on a memo, and what it does to the chain.

    **Configuration, not code**, for the same reason salary components are:
    every organisation has its own vocabulary — *recommended*, *noted*,
    *reviewed*, *verified*, *supported*, *forwarded*, *seen* — and the list is
    argued over, added to, and worded in ways an outsider would not guess. A
    fixed enum would mean a deploy to add "verified", and a free-text box would
    mean the same word spelled four ways in one year's records.

    **`effect` is what makes it more than a label.** There are exactly two
    things a handler can do to a memo: send it on, or send it back. Everything
    else is which word appears in the log. Holding that as a field means the
    machinery reads `effect` and never a name, so adding a vocabulary word is a
    row and never a branch.

    Managed by the owner or an HR admin, read by everybody — the same split the
    payroll component table has.
    """

    class Effect(models.TextChoices):
        #: Move the memo forward: to the next recommender, or to the approver.
        PROCEED = "proceed", "Send it on"
        #: Send it back to somebody who has already handled it.
        RETURN = "return", "Send it back"

    name = models.CharField(max_length=60, unique=True)
    code = models.CharField(max_length=20, unique=True)
    effect = models.CharField(max_length=10, choices=Effect.choices, default=Effect.PROCEED)
    description = models.CharField(max_length=255, blank=True)
    #: Order in the dropdown a handler sees. Data, not alphabetical: the word
    #: most often chosen should be the first one offered.
    order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    #: Whether the approver may use it. "Recommended" is not something an
    #: approver says, and offering it there invites a memo that is neither
    #: approved nor refused and has nowhere left to go.
    for_approver = models.BooleanField(
        default=False,
        help_text="Also offered to the approver. Most recommendation words are not.",
    )

    class Meta:
        ordering = ["order", "name"]

    def __str__(self):
        return self.name


class MemorandumCounter(models.Model):
    """The next serial number, per company.

    **A row rather than `MAX(serial) + 1`.** Two people pressing Submit in the
    same second both read the same maximum and both write it, and the loser
    finds out through a unique-constraint error on a document they have already
    written. This row is taken with `select_for_update`, so the second submit
    waits rather than fails.

    **Never reset.** Serials that restart each fiscal year are the local norm
    and are deliberately not used here: a reset means the year has to be part
    of uniqueness, and the pair of them then has to be right across a year
    boundary and under concurrency at once. The date is already in the
    memorandum id, so a running number loses nothing a reader needs. If a
    customer's registry demands a yearly reset, this is the one place to change
    it.
    """

    company = models.OneToOneField(
        "companies.Company", on_delete=models.CASCADE, related_name="memo_counter"
    )
    next_serial = models.PositiveIntegerField(default=1)

    def __str__(self):
        return f"{self.company_id}: next {self.next_serial}"


class Memorandum(AuditModel):
    """One memorandum, and where it currently sits."""

    class Status(models.TextChoices):
        #: Written and not yet sent. Only the initiator can see it.
        DRAFT = "draft", "Draft"
        #: Somewhere in the chain. `current_holder` says with whom.
        IN_PROGRESS = "in_progress", "In progress"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        #: Filed away by the initiator. **Not a decision** — a decided
        #: memorandum is evidence and stays that way — this is the register
        #: saying the matter is closed and it need not appear in anybody's
        #: working list. Only the initiator archives, because the initiator is
        #: the one who knows whether the thing it asked for actually happened.
        ARCHIVED = "archived", "Archived"

    class Stage(models.TextChoices):
        DRAFT = "draft", "Draft"
        RECOMMEND = "recommend", "With a recommender"
        APPROVE = "approve", "With the approver"
        CLOSED = "closed", "Closed"

    #: Blank until submission. `yyyy-mm-dd-CODE-000n`, built in
    #: `memoranda.workflow.submit` — see `MemorandumCounter` for the serial.
    memo_id = models.CharField(max_length=60, blank=True, unique=True, null=True)
    company = models.ForeignKey(
        "companies.Company", on_delete=models.PROTECT, related_name="memoranda"
    )
    #: The date written on the memo. Validated on submit to be today: a
    #: memorandum is dated the day it is raised, and back-dating one is how a
    #: register stops being a register.
    memo_date = models.DateField()
    subject = models.CharField(max_length=300)
    #: Rich text, stored as sanitised HTML — see `memoranda.sanitize`.
    #:
    #: **The only field that stays editable after submission**, and only until
    #: the memo is approved or rejected. That is the point of returning one:
    #: somebody sends it back saying the third paragraph is wrong, and the
    #: initiator fixes the third paragraph. Everything else — the date, the
    #: subject, the company, the attachments — is what the chain has already
    #: been reading, and changing it underneath them would make every comment
    #: above it a comment on a different document.
    content = models.TextField(blank=True)

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    stage = models.CharField(max_length=20, choices=Stage.choices, default=Stage.DRAFT)

    initiator = models.ForeignKey(
        "employees.Employee", on_delete=models.PROTECT, related_name="memoranda_initiated"
    )
    #: The one person who can end it. Changeable while the memo has not reached
    #: them; fixed once it has, because by then they are reading it.
    approver = models.ForeignKey(
        "employees.Employee",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="memoranda_to_approve",
    )

    #: Whose desk it is on. Stored rather than derived from `stage` and
    #: `current_index`, because "what needs me today" is the query this module
    #: exists to answer and it has to be one indexed lookup.
    current_holder = models.ForeignKey(
        "employees.Employee",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="memoranda_awaiting",
    )
    #: How far up the chain it has got. `0` is the first recommender. Moves
    #: backwards on a return, which is what "it restarts from the point it was
    #: returned to" means mechanically.
    current_index = models.PositiveSmallIntegerField(default=0)

    serial_number = models.PositiveIntegerField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-submitted_at", "-created_at", "-id"]
        indexes = [
            # The two lists every memorandum screen is built from.
            models.Index(fields=["current_holder", "status"]),
            models.Index(fields=["initiator", "status"]),
        ]

    def __str__(self):
        return f"{self.memo_id or 'draft'} — {self.subject}"

    @property
    def is_locked(self):
        """Decided, and therefore evidence.

        Checked on every write path rather than only hidden in the UI: an
        approved memorandum that can still be edited is not a record of what
        was approved.
        """
        return self.status in (self.Status.APPROVED, self.Status.REJECTED, self.Status.ARCHIVED)

    @property
    def chain(self):
        """The recommenders, in the order the initiator drew them."""
        return list(self.recommenders.select_related("employee__user").order_by("order"))


class MemorandumRecommender(AuditModel):
    """One link in the chain, and its place in it.

    **`order` is data the initiator chose**, not a derived rank — see the
    module docstring. It is dense and zero-based, and `memoranda.workflow`
    renumbers on every edit so `current_index` can be an index into it rather
    than a search.

    There is deliberately **no `acted_at` here.** Whether somebody has handled
    this memo is a question about its history, and its history is
    `MemorandumEvent` — which survives a return, whereas a flag on this row
    would have to be cleared on every loop and would then answer "has acted
    since the last return", which is not the question anybody asks. The one
    rule that depends on it — *somebody who has acted cannot be removed from
    the chain* — reads the log.
    """

    memorandum = models.ForeignKey(
        Memorandum, on_delete=models.CASCADE, related_name="recommenders"
    )
    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.PROTECT, related_name="memorandum_steps"
    )
    order = models.PositiveSmallIntegerField()

    class Meta:
        ordering = ["order"]
        constraints = [
            models.UniqueConstraint(
                fields=["memorandum", "employee"], name="unique_memo_recommender"
            ),
            models.UniqueConstraint(
                fields=["memorandum", "order"], name="unique_memo_recommender_order"
            ),
        ]

    def __str__(self):
        return f"{self.memorandum_id} #{self.order}: {self.employee_id}"


class MemorandumAttachment(AuditModel):
    """A file on a memorandum.

    Many, and optional. Fixed at submission along with everything else that is
    not the content: a chain that has been reading three annexes must not find
    a fourth appear beneath its comments.
    """

    memorandum = models.ForeignKey(
        Memorandum, on_delete=models.CASCADE, related_name="attachments"
    )
    #: The comment this file came in on, if it did.
    #:
    #: **One table, two jobs, and the null is the distinction.** A memorandum's
    #: annexes (`event=None`) are part of the proposal and are fixed at
    #: submission — a chain that has read three annexes must not find a fourth
    #: appear beneath its comments. A file attached to a *comment* is the
    #: opposite: it is somebody answering a question that came up mid-flight
    #: ("attach the survey"), and refusing it would mean the answer arrives by
    #: email and leaves no trace on the record.
    #:
    #: Kept on this model rather than a second one because they are the same
    #: object — a file with a caption, on a memorandum, uploaded by somebody —
    #: and splitting them would fork the upload path, the storage layout and
    #: the serializer to express a difference one nullable column already says.
    event = models.ForeignKey(
        "memoranda.MemorandumEvent", null=True, blank=True,
        on_delete=models.CASCADE, related_name="attachments",
    )
    file = models.FileField(upload_to=memo_attachment_path)
    caption = models.CharField(max_length=200, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return self.caption or self.file.name


class MemorandumEvent(models.Model):
    """What happened to a memorandum, in order. Append-only.

    **This is the memorandum's real content**, in the sense that matters to
    anybody reading it later: the document says what was proposed and this says
    who agreed to it, in what words, and how many times it went back first.

    Never edited. A correction is a new entry — an event that could be rewritten
    would make the whole record worth less than the paper version it replaced.
    """

    class Kind(models.TextChoices):
        CREATED = "created", "Created"
        SUBMITTED = "submitted", "Submitted"
        #: A recommender sent it on. `action` says in what words.
        PROCEEDED = "proceeded", "Sent on"
        #: Sent back. `returned_to` says to whom.
        RETURNED = "returned", "Sent back"
        #: The initiator moved it past somebody who could not act — usually
        #: absent. A kind of its own rather than a `PROCEEDED` by the wrong
        #: person: the log has to show that this recommender did not see it.
        SKIPPED = "skipped", "Skipped"
        #: Filed by the initiator once the matter was closed.
        ARCHIVED = "archived", "Archived"
        RESUBMITTED = "resubmitted", "Sent forward again"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        #: The initiator changed the text while it was in flight, or changed
        #: part of the chain that had not been reached.
        EDITED = "edited", "Edited"
        COMMENTED = "commented", "Commented"

    memorandum = models.ForeignKey(Memorandum, on_delete=models.CASCADE, related_name="events")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )
    #: Who they were on *this* memo when they acted. Stored rather than
    #: recomputed, because the chain can change afterwards and the log has to
    #: keep saying what was true at the time.
    actor_employee = models.ForeignKey(
        "employees.Employee", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )
    actor_label = models.CharField(
        max_length=150, blank=True,
        help_text="Who acted, as they were named at the time.",
    )
    role = models.CharField(max_length=20, blank=True)
    action = models.ForeignKey(
        MemorandumAction, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )
    #: Frozen at write time. A configured action can be renamed later, and the
    #: log must keep saying the word that was actually used.
    action_label = models.CharField(max_length=60, blank=True)
    comment = models.TextField(blank=True)
    #: People named in the comment, so it reaches them.
    #:
    #: A memorandum is read by the chain, and the chain is the people who have
    #: to act. Everybody else who *should see this one paragraph* — the
    #: engineer who knows the ground conditions, the accountant who set the
    #: rate — has no place in it, and before this the only way to reach them
    #: was to leave the system. Naming somebody notifies them and lets them
    #: read the memorandum; it grants nothing else, and it is a deliberate act
    #: by somebody who already has access, exactly like adding a recommender.
    mentions = models.ManyToManyField(
        "employees.Employee", blank=True, related_name="memorandum_mentions"
    )
    returned_to = models.ForeignKey(
        "employees.Employee", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.memorandum_id}: {self.kind} by {self.actor_label}"
