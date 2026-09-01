"""Projects and the tasks that make them up.

**Why these moved out of `crm`.** They were defined beside clients, deals and
invoices because the first project the product needed was work done *for* a
customer. That is one kind of project and not the general one: a product build,
an office move and an internal migration are all projects with no client at
all, and a model that requires one cannot describe them.

CRM keeps what is genuinely about selling — clients, deals, invoices, the client
desk. Projects are work, and work is not a CRM concern. The link survives as a
nullable foreign key pointing this way, so a client-facing project still says
whose it is.

**One task model, and this is it.** The archived plan settles this explicitly:
"Tasks — one model, not two." A second task table is how an employee asked to
check "my tasks" ends up finding them in two places, and `timesheets.TimeEntry`
already logs hours against this one.
"""

from django.contrib.contenttypes.fields import GenericRelation
from django.db import models
from django.utils import timezone

from core.models import AuditModel
from employees.models import Employee
from core.archiving import ArchivableModel


class Project(ArchivableModel, AuditModel):
    """A body of work, for a client or for ourselves.

    **A project is never deleted.** It is put on hold or cancelled, and the row
    stays. This is the R2 removal decision for this model, and it is a state
    change rather than a delete for a reason that is specific rather than
    stylistic: a project is the parent of approved timesheets, of every task's
    history, and of the activity trail those tasks' figures are read from. A
    delete takes all of it — so the one gesture that tidies a finished project
    would also erase the evidence for everybody who worked on it, including the
    hours somebody has already been paid for.

    `on_hold` and `cancelled` are different facts and both are needed. On hold
    means the work is expected to resume; cancelled means it is not. Collapsing
    them would make "why did this stop?" unanswerable, which is the question
    asked about a stopped project.
    """

    class Status(models.TextChoices):
        PLANNING = "planning", "Planning"
        ACTIVE = "active", "Active"
        ON_HOLD = "on_hold", "On hold"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    #: Statuses that mean the work is not being done right now. Kept as a pair
    #: rather than a single `is_stopped` flag because the reason matters — see
    #: the class docstring.
    STOPPED_STATUSES = (Status.ON_HOLD, Status.CANCELLED)

    #: Nullable, and that is the point of the move. An internal project has no
    #: customer, and requiring one forced every internal piece of work to be
    #: filed under whichever client was least wrong.
    client = models.ForeignKey(
        "crm.Client",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="projects",
    )
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PLANNING)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    # `projects_owned`, not `owned_projects` — kept exactly as it was in `crm`.
    # Renaming a reverse accessor during a move is a second change hiding
    # inside the first, and it breaks every caller silently.
    owner = models.ForeignKey(
        Employee, null=True, blank=True, on_delete=models.SET_NULL, related_name="projects_owned"
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.client.name if self.client else 'internal'})"


class Sprint(AuditModel):
    """A named, date-boxed slice of a project's work.

    **Deliberately lightweight.** No story points, no velocity, no burndown —
    those belong to a planning product, and half-built Scrum is worse than
    none because it implies a discipline the tool cannot actually support.
    What this carries is what a team needs to answer "what are we doing this
    fortnight": a name, two dates and a goal.
    """

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="sprints")
    name = models.CharField(max_length=120)
    goal = models.TextField(blank=True)
    start_date = models.DateField()
    end_date = models.DateField()
    is_closed = models.BooleanField(default=False)

    class Meta:
        ordering = ["-start_date"]

    def __str__(self):
        return f"{self.name} ({self.start_date} → {self.end_date})"


class Milestone(AuditModel):
    """A date the project owes somebody else.

    **Not a sprint, and the distinction is the whole point.** A sprint is the
    team's own cadence — internal, repeating, moved without asking anybody. A
    milestone is a *commitment made outwards*: to a client, to a regulator, to
    another team waiting on the handover. On a client project it is what gets
    invoiced. Collapsing the two would mean either sprints that cannot slip
    without a conversation, or commitments a team can quietly move.

    So the fields differ from `Sprint` in ways that follow from that:

    - **One date, not two.** A commitment is a deadline. A sprint has a start
      because a team works through it; nobody outside cares when work on a
      milestone began.
    - **`is_billable`.** A sprint is never invoiced; a milestone frequently is,
      and CRM already holds the invoice this would attach to.
    - **No `is_closed` flag.** Whether a milestone is met is *derived* from its
      tasks, not asserted by somebody ticking a box. A flag would let a
      milestone read as delivered with open work under it, which is exactly the
      lie this record exists to prevent.

    **Removal is a delete, unlike a project.** A milestone is a plan, not a
    parent: nothing is stamped with it that would be orphaned, tasks simply
    detach (`SET_NULL`), and a commitment that was never made should not have
    to be carried forever as a cancelled row. That is the R2 decision here, and
    it is the opposite of `Project`'s for a reason that is about what depends
    on the row rather than about consistency.
    """

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="milestones")
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    due_date = models.DateField(help_text="The date this was promised for.")

    #: Moving a milestone is a decision, so the original date is kept rather
    #: than overwritten. "We said the 12th and delivered on the 30th" is the
    #: question anybody reviewing a project asks, and a mutable single date
    #: cannot answer it.
    original_due_date = models.DateField(
        null=True,
        blank=True,
        help_text="What the date was before it moved. Set automatically on the first change.",
    )

    is_billable = models.BooleanField(
        default=False,
        help_text="Whether reaching this triggers an invoice.",
    )
    #: Stamped when every task under the milestone is done. Derived, never set
    #: by hand — see the class docstring.
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["due_date"]

    def __str__(self):
        return f"{self.name} ({self.due_date})"

    def save(self, *args, **kwargs):
        """Remember the first date we promised.

        Recorded on the *first* move rather than at creation, so a milestone
        that never slipped does not carry a redundant copy of its own date and
        read as though it had.
        """
        if self.pk and self.original_due_date is None:
            previous = type(self).objects.filter(pk=self.pk).values_list("due_date", flat=True).first()
            if previous is not None and previous != self.due_date:
                self.original_due_date = previous
        super().save(*args, **kwargs)

    @property
    def has_slipped(self):
        return self.original_due_date is not None and self.due_date > self.original_due_date

    def progress(self):
        """Done and total, from the tasks — the only honest source.

        A milestone with no tasks under it returns `(0, 0)` rather than
        pretending to be complete. "Nothing attached yet" and "everything
        finished" are different answers, and a naive `done == total` check
        would give the same one for both.
        """
        rows = self.tasks.values_list("status", flat=True)
        total = len(rows)
        done = sum(1 for status in rows if status == ProjectTask.Status.DONE)
        return done, total

    def refresh_completion(self):
        """Recompute `completed_at` from the tasks beneath.

        Called when a task under a milestone changes status. Idempotent, and it
        *clears* the stamp as well as setting it: re-opening a task on a
        delivered milestone means it is no longer delivered, and a stamp that
        only ever moves forward would leave a milestone claiming completion
        with live work under it.
        """
        done, total = self.progress()
        reached = total > 0 and done == total
        if reached and self.completed_at is None:
            self.completed_at = timezone.now()
        elif not reached and self.completed_at is not None:
            self.completed_at = None
        else:
            return
        super().save(update_fields=["completed_at"])


class ProjectTask(AuditModel):
    """One piece of work.

    **A task, not a checklist item.** It carries a description, a status,
    comments, a priority and its own history, because a title with an `is_done`
    boolean cannot hold a conversation and cannot tell "nobody has started"
    from "somebody is stuck" — which is the distinction a board exists to show.

    `status` is the only record of completion. Keeping a boolean alongside it
    would be a second answer to one question.
    """

    class Status(models.TextChoices):
        TODO = "todo", "To do"
        IN_PROGRESS = "in_progress", "In progress"
        BLOCKED = "blocked", "Blocked"
        IN_REVIEW = "in_review", "In review"
        DONE = "done", "Done"

    class Priority(models.TextChoices):
        LOW = "low", "Low"
        NORMAL = "normal", "Normal"
        HIGH = "high", "High"
        URGENT = "urgent", "Urgent"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="tasks")
    sprint = models.ForeignKey(
        Sprint,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="tasks",
        #: Nullable because a backlog belongs to no sprint. A sprint that has
        #: to contain everything is not a sprint.
        help_text="The sprint this task is committed to, if any.",
    )
    milestone = models.ForeignKey(
        "Milestone",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="tasks",
        #: Independent of `sprint`, not an alternative to it. A task is done in
        #: some fortnight *and* counts towards some commitment; forcing a choice
        #: between the two would make one of the questions unanswerable.
        #:
        #: `SET_NULL` because deleting a plan must not delete the work — see the
        #: R2 note on `Milestone`.
        help_text="The commitment this task counts towards, if any.",
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.TODO)
    priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.NORMAL)

    assignee = models.ForeignKey(
        Employee, null=True, blank=True, on_delete=models.SET_NULL, related_name="project_tasks"
    )
    #: Who asked for it, which is a different question from who is doing it and
    #: the one people actually chase.
    assigned_by = models.ForeignKey(
        Employee, null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_tasks"
    )

    start_date = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    #: Stamped when the task first reaches `DONE`. Cycle time is the distance
    #: from creation to here, and deriving it from `updated_at` instead would
    #: move every time somebody edited a finished task.
    completed_at = models.DateTimeField(null=True, blank=True)

    order = models.PositiveIntegerField(default=0)

    # ── Breaking work down ───────────────────────────────────────────────
    #
    # **One level, deliberately.** A sub-task cannot itself have sub-tasks.
    # Arbitrary nesting sounds more capable and is worse in practice: a board
    # cannot draw a tree, "how far through is this" stops having an answer, and
    # somebody always builds a five-deep hierarchy nobody else can read. Jira
    # draws the same line for the same reason.
    #
    # `CASCADE`, because a sub-task is part of its parent rather than a task
    # that happens to reference one. Deleting the parent and leaving orphans
    # behind would put work on the board with no context for why it exists.
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="subtasks",
        help_text="The task this is a step of. Sub-tasks cannot have sub-tasks of their own.",
    )

    #: How long this is expected to take, in hours.
    #:
    #: **Hours, not story points.** `timesheets.TimeEntry` already records hours
    #: actually worked against a task, so an estimate in hours can be compared
    #: to something the system already holds. Points would be a second unit that
    #: can never be checked against reality, and a sprint whose capacity cannot
    #: be checked is a sprint that teaches nobody anything.
    estimate_hours = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True,
        help_text="Expected hours. Comparable with the hours logged on timesheets.",
    )

    # ── What has to happen first ─────────────────────────────────────────
    #
    # **`BLOCKED` was a status with nothing behind it.** Somebody set it by hand
    # and what they were waiting on lived in their head or a comment — so the
    # board could say "stuck" and never say *on what*, and nobody could tell a
    # task still genuinely blocked from one whose blocker finished last week.
    #
    # Not symmetrical: "A must wait for B" does not mean B waits for A. The
    # reverse side is `blocks`, which is the question a person actually asks
    # about their own work — "who is waiting on me?".
    #
    # Same project only, for now. A board cannot draw a dependency on a task it
    # does not show, and a half-drawn graph is worse than none. Cross-project
    # blocking is real and deliberately deferred rather than half-built.
    blocked_by = models.ManyToManyField(
        "self",
        symmetrical=False,
        blank=True,
        related_name="blocks",
        help_text="Tasks that must finish before this one can start.",
    )

    #: Files pinned to this task, over the generic `documents.Document` store.
    #:
    #: **Declared purely so a delete cascades.** Without a `GenericRelation`
    #: Django knows nothing about the reverse side of a generic key, so
    #: deleting a task left its `Document` rows pointing at an `object_id` that
    #: no longer resolves — invisible to every list endpoint, indistinguishable
    #: from live rows, and holding files on disk nothing would ever reclaim.
    #: Nothing reads this attribute; the serializer still queries `Document`
    #: directly by content type.
    attachments = GenericRelation(
        "documents.Document",
        content_type_field="content_type",
        object_id_field="object_id",
        related_query_name="project_task",
    )

    class Meta:
        ordering = ["order", "id"]
        indexes = [
            # The two questions asked constantly: "what is on this board" and
            # "what is on my plate".
            models.Index(fields=["project", "status"]),
            models.Index(fields=["assignee", "status"]),
        ]

    def __str__(self):
        return f"{self.title} ({self.get_status_display()})"

    def clean(self):
        """Refuse the two shapes that make a hierarchy unreadable.

        Enforced in `clean` and again in the serializer: a management command or
        a shell session can write a model directly, and the rule is about the
        data rather than about one API.
        """
        from django.core.exceptions import ValidationError

        if self.parent_id is None:
            return
        if self.parent_id == self.pk:
            raise ValidationError({"parent": "A task cannot be a step of itself."})
        parent = ProjectTask.objects.filter(pk=self.parent_id).only(
            "parent_id", "project_id"
        ).first()
        if parent is None:
            return
        if parent.parent_id is not None:
            raise ValidationError(
                {"parent": "Sub-tasks cannot have sub-tasks of their own — keep it one level deep."}
            )
        if parent.project_id != self.project_id:
            # Otherwise a task appears under a parent on a board it is not on,
            # and its project's progress bar counts work filed somewhere else.
            raise ValidationError({"parent": "A sub-task must be on the same project as its parent."})

    def blocking_reasons(self):
        """The blockers that have not finished yet.

        **Unfinished, not merely linked.** A dependency on a task that is done
        is history rather than an obstruction, and counting it would leave
        everything permanently blocked by its own past.
        """
        return [t for t in self.blocked_by.all() if t.status != ProjectTask.Status.DONE]

    @property
    def is_blocked(self):
        """Whether anything is actually in the way, right now.

        Derived rather than stored, so it cannot disagree with the tasks it is
        derived from — the same reason project progress is counted rather than
        cached.
        """
        return bool(self.blocking_reasons())

    def would_cycle(self, blocker):
        """Would depending on `blocker` create a loop?

        🔒 **A cycle is not a slow query, it is a hang.** "What is blocking
        this?" walks the graph, and A→B→A never terminates — so the check is a
        breadth-first walk *before* the edge exists rather than a depth limit
        after it.
        """
        if blocker.pk == self.pk:
            return True
        seen = set()
        frontier = [blocker]
        while frontier:
            current = frontier.pop()
            if current.pk in seen:
                continue
            seen.add(current.pk)
            if current.pk == self.pk:
                return True
            frontier.extend(current.blocked_by.all())
        return False

    @property
    def is_subtask(self):
        return self.parent_id is not None

    def subtask_progress(self):
        """`(done, total)` across this task's own steps."""
        rows = list(self.subtasks.values_list("status", flat=True))
        return sum(1 for status in rows if status == self.Status.DONE), len(rows)


class TaskComment(AuditModel):
    """A remark on a task.

    Separate from the activity trail on purpose. A comment is something a
    person chose to write; the trail is what the system observed. Merging them
    produces a feed where "moved to In review" and "this is blocked on the
    client" carry the same weight, and the second is the one worth reading.
    """

    task = models.ForeignKey(ProjectTask, on_delete=models.CASCADE, related_name="comments")
    body = models.TextField()

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"comment on {self.task_id}"


class TaskActivity(models.Model):
    """What changed on a task, and who changed it.

    Not an `AuditModel`: this *is* the audit record, and giving it its own
    created/updated pair would mean a row describing a change that could itself
    be edited. Written once, never altered.

    Kept because a completion figure nobody can trace is a figure nobody will
    trust — and these numbers are going into performance conversations.
    """

    task = models.ForeignKey(ProjectTask, on_delete=models.CASCADE, related_name="activity")
    actor = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    field = models.CharField(max_length=40)
    from_value = models.CharField(max_length=120, blank=True)
    to_value = models.CharField(max_length=120, blank=True)
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-at"]
        verbose_name_plural = "task activity"

    def __str__(self):
        return f"{self.field}: {self.from_value} → {self.to_value}"
