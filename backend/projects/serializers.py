from rest_framework import serializers

from documents.models import Document
from projects.models import (
    Milestone,
    Project,
    ProjectTask,
    Sprint,
    TaskActivity,
    TaskComment,
)


class ProjectSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source="client.name", read_only=True, default=None)
    owner_name = serializers.SerializerMethodField()
    # Read annotations from the queryset (ProjectViewSet.get_queryset) instead
    # of per-row .count()/.filter().count() — those ignore any prefetch and
    # fire 2 fresh COUNT queries per project (N+1). Fall back for non-annotated
    # instances (e.g. a fresh object returned right after create).
    task_count = serializers.IntegerField(read_only=True)
    done_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Project
        fields = [
            "id",
            "client",
            "client_name",
            "name",
            "description",
            "status",
            "start_date",
            "end_date",
            "owner",
            "owner_name",
            "task_count",
            "done_count",
        ]

    def get_owner_name(self, obj):
        if obj.owner is None:
            return None
        return obj.owner.user.get_full_name() or obj.owner.user.get_username()

    def to_representation(self, instance):
        # Annotations may be absent on a freshly-created instance; default to 0.
        if not hasattr(instance, "task_count"):
            instance.task_count = instance.tasks.count()
        if not hasattr(instance, "done_count"):
            instance.done_count = instance.tasks.filter(status=ProjectTask.Status.DONE).count()
        return super().to_representation(instance)


class SprintSerializer(serializers.ModelSerializer):
    task_count = serializers.IntegerField(read_only=True)
    done_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Sprint
        fields = [
            "id", "project", "name", "goal", "start_date", "end_date",
            "is_closed", "task_count", "done_count",
        ]


class MilestoneSerializer(serializers.ModelSerializer):
    """A commitment, with how far through it actually is.

    Everything about whether it is met is **read-only and derived**. There is no
    "mark as complete" here on purpose: a milestone that can be ticked can be
    ticked with open work under it, and the record then says the opposite of the
    truth to exactly the person — a client, an invoicing clerk — it exists to
    inform.
    """

    done_count = serializers.SerializerMethodField()
    task_count = serializers.SerializerMethodField()
    is_complete = serializers.SerializerMethodField()
    #: Late means the date passed with work outstanding. A milestone delivered
    #: after its date is *slipped*, not late — it landed, and calling it late
    #: forever would make the flag useless for finding what needs attention now.
    is_late = serializers.SerializerMethodField()
    has_slipped = serializers.BooleanField(read_only=True)

    class Meta:
        model = Milestone
        fields = [
            "id", "project", "name", "description", "due_date",
            "original_due_date", "has_slipped", "is_billable",
            "completed_at", "is_complete", "is_late",
            "done_count", "task_count",
        ]
        read_only_fields = [
            "id", "original_due_date", "has_slipped", "completed_at",
            "is_complete", "is_late", "done_count", "task_count",
        ]

    def _progress(self, obj):
        # Annotated by the viewset for lists; computed for a bare instance.
        done = getattr(obj, "done_total", None)
        total = getattr(obj, "task_total", None)
        if done is None or total is None:
            return obj.progress()
        return done, total

    def get_done_count(self, obj):
        return self._progress(obj)[0]

    def get_task_count(self, obj):
        return self._progress(obj)[1]

    def get_is_complete(self, obj):
        return obj.completed_at is not None

    def get_is_late(self, obj):
        from django.utils import timezone

        if obj.completed_at is not None:
            return False
        return obj.due_date < timezone.localdate()


class TaskCommentSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = TaskComment
        fields = ["id", "task", "body", "author_name", "created_at"]
        read_only_fields = ["id", "author_name", "created_at"]

    def get_author_name(self, obj):
        if obj.created_by is None:
            return None
        return obj.created_by.get_full_name() or obj.created_by.get_username()


class TaskActivitySerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = TaskActivity
        fields = ["id", "field", "from_value", "to_value", "actor_name", "at"]

    def get_actor_name(self, obj):
        if obj.actor is None:
            return None
        return obj.actor.get_full_name() or obj.actor.get_username()


class ProjectTaskSerializer(serializers.ModelSerializer):
    assignee_name = serializers.SerializerMethodField()
    assigned_by_name = serializers.SerializerMethodField()
    project_name = serializers.CharField(source="project.name", read_only=True)
    comment_count = serializers.IntegerField(read_only=True, default=0)
    subtask_done = serializers.SerializerMethodField()
    subtask_total = serializers.SerializerMethodField()
    logged_hours = serializers.SerializerMethodField()
    #: The blockers that have not finished, named rather than counted — "this
    #: is blocked" is not actionable; "blocked by *Migrate the database*" is.
    milestone_name = serializers.CharField(
        source="milestone.name", read_only=True, default=None
    )
    blockers = serializers.SerializerMethodField()
    is_blocked = serializers.SerializerMethodField()
    #: How many tasks are waiting on *this* one, which is the question somebody
    #: asks about their own work: am I holding anybody up?
    blocking_count = serializers.SerializerMethodField()

    class Meta:
        model = ProjectTask
        fields = [
            "id",
            "project",
            "project_name",
            "sprint",
            "title",
            "description",
            "status",
            "priority",
            "assignee",
            "assignee_name",
            "assigned_by",
            "assigned_by_name",
            "start_date",
            "due_date",
            "completed_at",
            "order",
            "comment_count",
            "created_at",
            "parent",
            "estimate_hours",
            "subtask_done",
            "subtask_total",
            "logged_hours",
            "milestone",
            "milestone_name",
            "blocked_by",
            "blockers",
            "is_blocked",
            "blocking_count",
        ]
        # `completed_at` is stamped by the service when a task reaches DONE.
        # Writable, it would let a caller claim a completion date that never
        # happened — and these dates feed cycle time.
        read_only_fields = [
            "id", "completed_at", "created_at", "comment_count",
            "subtask_done", "subtask_total", "logged_hours",
            "milestone_name", "blockers", "is_blocked", "blocking_count",
        ]

    def validate(self, attrs):
        """The two shapes that make a hierarchy unreadable, refused on save.

        `ProjectTask.clean` says the same thing for anything writing the model
        directly. Repeated here because a serializer does not call `clean`, and
        a 400 naming the problem is a better answer than an `IntegrityError`.
        """
        parent = attrs.get("parent", getattr(self.instance, "parent", None))
        if parent is None:
            return attrs

        if self.instance is not None and parent.pk == self.instance.pk:
            raise serializers.ValidationError({"parent": "A task cannot be a step of itself."})
        if parent.parent_id is not None:
            raise serializers.ValidationError(
                {"parent": "Sub-tasks cannot have sub-tasks of their own — keep it one level deep."}
            )
        project = attrs.get("project", getattr(self.instance, "project", None))
        if project is not None and parent.project_id != project.pk:
            raise serializers.ValidationError(
                {"parent": "A sub-task must be on the same project as its parent."}
            )
        # A parent with steps of its own cannot become somebody else's step —
        # that is the second level arriving by the back door.
        if self.instance is not None and self.instance.subtasks.exists():
            raise serializers.ValidationError(
                {"parent": "This task already has sub-tasks, so it cannot become one itself."}
            )
        return attrs

    def validate_blocked_by(self, value):
        """The three shapes that make a dependency graph unusable.

        Checked here as well as on the model, because a serializer does not
        call `clean()` and a 400 naming the problem beats an `IntegrityError`.
        """
        if self.instance is not None:
            for blocker in value:
                if blocker.pk == self.instance.pk:
                    raise serializers.ValidationError(
                        "A task cannot wait for itself."
                    )
                # 🔒 A cycle is a hang, not a slow query — "what is blocking
                # this?" walks the graph and A→B→A never terminates.
                if self.instance.would_cycle(blocker):
                    raise serializers.ValidationError(
                        f"“{blocker.title}” already waits on this task, directly or "
                        f"through another — adding this would make a loop neither "
                        f"could ever leave."
                    )

        project = None
        if self.instance is not None:
            project = self.instance.project_id
        for blocker in value:
            if project is not None and blocker.project_id != project:
                raise serializers.ValidationError(
                    "A task can only wait for another task on the same project."
                )
        return value

    def get_subtask_done(self, obj):
        return getattr(obj, "subtask_done_count", None) or 0

    def get_subtask_total(self, obj):
        return getattr(obj, "subtask_total_count", None) or 0

    def get_blockers(self, obj):
        return [
            {"id": t.id, "title": t.title, "status": t.status}
            for t in obj.blocking_reasons()
        ]

    def get_is_blocked(self, obj):
        # `blocking_reasons` reads the prefetched `blocked_by`, so asking twice
        # on the same instance costs nothing beyond the list comprehension.
        return obj.is_blocked

    def get_blocking_count(self, obj):
        # Annotated on the list queryset; the fallback is for a bare instance
        # (a fresh create, a nested render) where the annotation is absent.
        annotated = getattr(obj, "blocking_total", None)
        if annotated is not None:
            return annotated
        return obj.blocks.exclude(status=ProjectTask.Status.DONE).count()

    def get_logged_hours(self, obj):
        """Hours actually booked against this task, for comparison with the
        estimate. Annotated on the queryset; zero when nothing is logged."""
        return str(getattr(obj, "logged_hours_total", None) or "0.00")

    def _name(self, employee):
        if employee is None:
            return None
        return employee.user.get_full_name() or employee.user.get_username()

    def get_assignee_name(self, obj):
        return self._name(obj.assignee)

    def get_assigned_by_name(self, obj):
        return self._name(obj.assigned_by)


class TaskAttachmentSerializer(serializers.ModelSerializer):
    """A file on a task, over the generic `Document` store.

    No new model. `documents.Document` already attaches a file to any
    company-scoped record through ContentType, and its upload path already
    carries the schema name so the company's uploads cannot collide with
    another's. A second file store would have to reinvent both, and would then
    be the one somebody forgets when the storage backend changes.

    `task` is write-only and resolved into content_type/object_id, so a caller
    never has to know ContentType exists.
    """

    task = serializers.IntegerField(write_only=True)
    uploaded_by_name = serializers.SerializerMethodField()
    size = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = ["id", "task", "file", "original_filename", "uploaded_by_name", "size", "created_at"]
        read_only_fields = ["id", "original_filename", "uploaded_by_name", "size", "created_at"]
        extra_kwargs = {"file": {"write_only": True}}

    def get_uploaded_by_name(self, obj):
        if obj.created_by is None:
            return None
        return obj.created_by.get_full_name() or obj.created_by.get_username()

    def get_size(self, obj):
        """Bytes, or None when the file is gone from disk.

        Reads the stored size rather than assuming it is there: a row whose
        file has been removed underneath it should render as a broken
        attachment, not raise on a list request that has nothing else wrong
        with it.
        """
        try:
            return obj.file.size
        except (OSError, ValueError):
            return None

    def validate_task(self, value):
        if not ProjectTask.objects.filter(pk=value).exists():
            raise serializers.ValidationError("No such task.")
        return value
