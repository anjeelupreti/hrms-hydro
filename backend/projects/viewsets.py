from django.contrib.contenttypes.models import ContentType
from django.db.models import Count, DecimalField, OuterRef, Q, Subquery, Sum
from django.http import FileResponse, Http404
from django.utils import timezone
from django_filters import rest_framework as django_filters
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.mixins import (
    CreateModelMixin,
    DestroyModelMixin,
    ListModelMixin,
    RetrieveModelMixin,
    UpdateModelMixin,
)
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from accounts.policy import Perm, can
from attendance.permissions import _requesting_employee
from core.counts import StatusCountsMixin
from core.filters import IdsLookupMixin
from core.viewsets import AuditViewSetMixin
from documents.models import Document
from projects.models import (
    Milestone,
    Project,
    ProjectTask,
    Sprint,
    TaskActivity,
    TaskComment,
)
from projects.permissions import (
    CanWriteProject,
    CanWriteTask,
    is_workplace_manager,
    may_write_task,
    owns_project,
)
from projects.serializers import (
    MilestoneSerializer,
    ProjectSerializer,
    ProjectTaskSerializer,
    SprintSerializer,
    TaskActivitySerializer,
    TaskAttachmentSerializer,
    TaskCommentSerializer,
)
from timesheets.models import TimeEntry
from core.archiving import ArchiveMixin

PERMISSION_CLASSES = [IsAuthenticated]
#: Read for everyone in the company; writes decided by `projects.permissions`.
WRITE_PROJECT = PERMISSION_CLASSES + [CanWriteProject]


class ProjectViewSet(
    ArchiveMixin, IdsLookupMixin,
    StatusCountsMixin,
    AuditViewSetMixin,
    ListModelMixin,
    RetrieveModelMixin,
    CreateModelMixin,
    UpdateModelMixin,
    GenericViewSet,
):
    """Projects. **No destroy — deliberately.**

    `DestroyModelMixin` is absent rather than overridden, so `DELETE` is not a
    route at all and DRF answers 405 by itself. Overriding `destroy` to raise
    would leave the method advertised in `Allow:` and in the browsable API,
    which is a worse answer than not having it: it says the operation exists
    and you may not do it, when in fact it does not exist for anybody.

    The removal path is `status` — **on hold** or **cancelled**, both writable
    through the ordinary `PATCH`. See `Project`'s docstring for why a delete
    would take the approved timesheets and the activity trail with it.
    """

    serializer_class = ProjectSerializer
    permission_classes = WRITE_PROJECT
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_fields = ["client", "status", "owner"]
    search_fields = ["name", "client__name"]
    ordering_fields = ["name", "start_date", "end_date", "created_at"]
    ordering = ["-created_at"]

    def get_queryset(self):
        # Annotate task/done counts in SQL (one query) instead of 2 COUNTs per
        # row in the serializer. Counts on `status` now rather than `is_done`,
        # which the model no longer has.
        return Project.objects.select_related("client", "owner__user").annotate(
            task_count=Count("tasks", distinct=True),
            done_count=Count(
                "tasks", filter=Q(tasks__status=ProjectTask.Status.DONE), distinct=True
            ),
        )

    @action(detail=False, methods=["get"], url_path="portfolio-summary")
    def portfolio_summary(self, request, *args, **kwargs):
        """The portfolio in one line: how much of the work is actually done,
        and what is stuck.

        A project list shows names and statuses. What it cannot show is that the
        thirty-seven of them contain four hundred tasks of which a third are
        finished and nine are **blocked** — and blocked is the only state on the
        board that nobody can clear by working harder, so it is the one worth
        raising to the top of the page.

        Counted over `tasks`, not over projects, because a project marked
        "active" says nothing about whether it is moving.

        Archived projects are excluded: the archive exists so that finished work
        stops distorting today's picture, and a portfolio reading that counted
        last year's completed projects would report a health nobody is
        responsible for any more.
        """
        projects = Project.objects.filter(archived_at__isnull=True)
        tasks = ProjectTask.objects.filter(project__in=projects)
        today = timezone.localdate()

        done = tasks.filter(status=ProjectTask.Status.DONE).count()
        total = tasks.count()

        return Response(
            {
                "projects_active": projects.filter(status=Project.Status.ACTIVE).count(),
                "projects_total": projects.count(),
                "tasks_total": total,
                "tasks_done": done,
                "tasks_blocked": tasks.filter(status=ProjectTask.Status.BLOCKED).count(),
                "tasks_in_progress": tasks.filter(
                    status=ProjectTask.Status.IN_PROGRESS
                ).count(),
                # Overdue means unfinished *and* past its date — a task
                # delivered late is not still overdue, it is done.
                "tasks_overdue": tasks.filter(due_date__lt=today)
                .exclude(status=ProjectTask.Status.DONE)
                .count(),
                "tasks_unassigned": tasks.filter(assignee__isnull=True)
                .exclude(status=ProjectTask.Status.DONE)
                .count(),
            }
        )


class SprintViewSet(AuditViewSetMixin, ModelViewSet):
    serializer_class = SprintSerializer
    permission_classes = WRITE_PROJECT
    filter_backends = [django_filters.DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["project", "is_closed"]
    ordering_fields = ["start_date", "end_date", "name"]
    ordering = ["-start_date"]

    def get_queryset(self):
        return Sprint.objects.select_related("project").annotate(
            task_count=Count("tasks", distinct=True),
            done_count=Count(
                "tasks", filter=Q(tasks__status=ProjectTask.Status.DONE), distinct=True
            ),
        )


class MilestoneViewSet(AuditViewSetMixin, ModelViewSet):
    """Commitments on a project, and how far through each one is.

    **Delete is allowed here, unlike `Project`.** The R2 question is what
    depends on the row: nothing is stamped with a milestone, tasks detach
    cleanly (`SET_NULL`), and a commitment that was never really made should not
    have to be carried forever as a cancelled row. A project is the parent of
    approved timesheets and of every task's history, which is why that one is a
    state change instead. Same rule, different answer, because the facts differ.
    """

    serializer_class = MilestoneSerializer
    permission_classes = WRITE_PROJECT
    filter_backends = [django_filters.DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["project", "is_billable"]
    ordering_fields = ["due_date", "name"]
    ordering = ["due_date"]

    def get_queryset(self):
        # Progress is read on every row, so it is counted in the database
        # rather than by walking `tasks` once per milestone.
        return Milestone.objects.select_related("project").annotate(
            task_total=Count("tasks", distinct=True),
            done_total=Count(
                "tasks", filter=Q(tasks__status=ProjectTask.Status.DONE), distinct=True
            ),
        )

    def perform_destroy(self, instance):
        """Refuse to delete a commitment that has already been met.

        🔒 A reached milestone is a *record*, not a plan — on a billable one it
        is the evidence behind an invoice. Removing it erases the answer to
        "what did we deliver, and when". An unmet milestone is only a plan, and
        dropping a plan nobody kept is housekeeping.

        Guarded here rather than by hiding the button, because the API is the
        thing that has to hold.
        """
        if instance.completed_at is not None:
            raise ValidationError(
                {
                    "detail": (
                        f"“{instance.name}” has been reached — it is a record of "
                        "what was delivered, not a plan. Detach its tasks first if it was "
                        "created by mistake."
                    )
                }
            )
        super().perform_destroy(instance)


class ProjectTaskViewSet(StatusCountsMixin, AuditViewSetMixin, ModelViewSet):
    """Tasks, and the two things a board needs to do to them.

    `mine` and the status counts exist because "what am I working on" and "what
    is on this board" are the two questions asked constantly, and answering
    either by filtering a page in the browser gets the wrong answer the moment
    there are more tasks than fit on one.
    """

    serializer_class = ProjectTaskSerializer
    permission_classes = PERMISSION_CLASSES + [CanWriteTask]
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_fields = [
        "project", "sprint", "milestone", "status", "priority", "assignee",
        "assigned_by", "parent",
    ]
    search_fields = ["title", "description", "project__name"]
    ordering_fields = ["order", "due_date", "priority", "created_at", "completed_at"]
    ordering = ["order", "id"]

    def get_queryset(self):
        queryset = (
            ProjectTask.objects.select_related("project", "assignee__user", "assigned_by__user")
            # Blockers are read for every row — the board shows *what* is
            # holding a task, not just that something is. Without this the
            # serializer asks the database once per task, twice over.
            .prefetch_related("blocked_by")
            .annotate(
                comment_count=Count("comments", distinct=True),
                # How many tasks are waiting on this one. Counted here rather
                # than walked in the serializer for the same reason: the number
                # is wanted on every row of the list.
                blocking_total=Count(
                    "blocks", filter=~Q(blocks__status=ProjectTask.Status.DONE), distinct=True
                ),
                subtask_total_count=Count("subtasks", distinct=True),
                subtask_done_count=Count(
                    "subtasks",
                    filter=Q(subtasks__status=ProjectTask.Status.DONE),
                    distinct=True,
                ),
                # **A Subquery, not another aggregate.** Summing across a second
                # join in the same query multiplies the total by the number of
                # rows the other joins produced — a task with three comments
                # would report three times its logged hours. `distinct=True`
                # does not save it either: that de-duplicates equal *values*, so
                # two genuine two-hour entries would collapse into one.
                logged_hours_total=Subquery(
                    TimeEntry.objects.filter(task=OuterRef("pk"))
                    .values("task")
                    .annotate(total=Sum("hours"))
                    .values("total")[:1],
                    output_field=DecimalField(max_digits=8, decimal_places=2),
                ),
            )
        )

        # **Sub-tasks stay off the top level unless asked for.** A board that
        # shows every step as its own card is a board nobody can read, and the
        # column counts would say twelve where a person sees three pieces of
        # work. Pass `?parent=<id>` for one task's steps, or `?nested=1` to see
        # everything flat.
        if self.request.query_params.get("nested") in ("1", "true", "True"):
            return queryset
        if "parent" in self.request.query_params:
            return queryset
        return queryset.filter(parent__isnull=True)

    def perform_create(self, serializer):
        """Only a manager or the project's owner may add work to a project.

        Object-level permission cannot decide this — there is no object yet —
        so the posted project is checked here instead. Without it, anybody in
        the company could add tasks to any board.
        """
        project = serializer.validated_data.get("project")
        if not is_workplace_manager(self.request.user) and not owns_project(
            self.request.user, project
        ):
            raise PermissionDenied("You do not manage that project.")
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        # The activity trail is written from the diff, not from the caller
        # saying what changed. A completion figure nobody can trace is one
        # nobody will trust, and these numbers reach performance conversations.
        before = ProjectTask.objects.get(pk=serializer.instance.pk)
        task = serializer.save(updated_by=self.request.user)
        self._record_changes(before, task)

    def _record_changes(self, before, after):
        from django.utils import timezone

        tracked = [
            "status", "priority", "assignee", "sprint", "milestone", "due_date",
            "estimate_hours",
        ]
        for field in tracked:
            old = getattr(before, field)
            new = getattr(after, field)
            if old == new:
                continue
            TaskActivity.objects.create(
                task=after,
                actor=self.request.user,
                field=field,
                from_value=str(old) if old is not None else "",
                to_value=str(new) if new is not None else "",
            )

        # Stamped once, when it first arrives at done. Re-stamping on every
        # later edit would make cycle time drift every time somebody fixed a
        # typo on a finished task; clearing it on reopen is right, because a
        # task that is open has not been completed.
        if before.status != after.status:
            if after.status == ProjectTask.Status.DONE and after.completed_at is None:
                after.completed_at = timezone.now()
                after.save(update_fields=["completed_at"])
            elif after.status != ProjectTask.Status.DONE and after.completed_at is not None:
                after.completed_at = None
                after.save(update_fields=["completed_at"])

        # A milestone is reached when its tasks are, so this has to run on the
        # status change rather than be recomputed when somebody opens the page.
        # Both sides are refreshed when a task is *moved* between milestones:
        # the one it left may now be complete, and the one it joined may no
        # longer be.
        for milestone in {before.milestone, after.milestone} - {None}:
            milestone.refresh_completion()

    @action(detail=False, methods=["get"])
    def mine(self, request, *args, **kwargs):
        """Everything assigned to the caller that is not finished."""
        employee = _requesting_employee(request.user)
        if employee is None:
            return Response({"results": []})
        queryset = self.filter_queryset(
            self.get_queryset().filter(assignee=employee).exclude(status=ProjectTask.Status.DONE)
        )
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page if page is not None else queryset, many=True)
        return (
            self.get_paginated_response(serializer.data)
            if page is not None
            else Response(serializer.data)
        )

    @action(detail=False, methods=["post"])
    def reorder(self, request, *args, **kwargs):
        """Set the order of tasks within one column of a board.

        **The board could move a card between columns but not within one.** A
        drag that started and ended in the same column was discarded by the
        client and never reached here — so `order` existed, was the default
        ordering, and could only ever be changed by editing the database. On a
        column of twenty tasks with no way to say which matters most, "what do I
        pick up next" had no answer the board could give.

        Takes the ids in their new order and writes positions in one pass. The
        whole column is sent rather than "move id X to index 3", because a
        position is only meaningful relative to its neighbours: two people
        dragging at once with index instructions produce an order neither of
        them asked for, where the last full list to arrive simply wins.

        🔒 **Every task is checked, not just the first.** A caller who may write
        to one task in the list is not thereby allowed to reshuffle a column
        containing somebody else's — the permission is per row, so the check is
        too, and one refusal rejects the whole request rather than applying a
        partial reorder nobody asked for.
        """
        ids = request.data.get("ids")
        if not isinstance(ids, list) or not ids:
            raise ValidationError({"ids": "Send the task ids in their new order."})

        try:
            wanted = [int(value) for value in ids]
        except (TypeError, ValueError):
            raise ValidationError({"ids": "Task ids must be numbers."}) from None

        tasks = {task.id: task for task in ProjectTask.objects.select_related("project").filter(pk__in=wanted)}
        missing = [value for value in wanted if value not in tasks]
        if missing:
            raise ValidationError({"ids": f"No such task: {missing[0]}."})

        # A column belongs to one project. Reordering across two at once is
        # meaningless — the orders are independent — and would silently
        # interleave them.
        projects = {task.project_id for task in tasks.values()}
        if len(projects) > 1:
            raise ValidationError({"ids": "Those tasks are not all on the same project."})

        for task in tasks.values():
            if not may_write_task(request.user, task):
                raise PermissionDenied("Some of those tasks are not yours to reorder.")

        # Gaps of ten, so a later single insertion has somewhere to go without
        # rewriting the column.
        for position, task_id in enumerate(wanted):
            tasks[task_id].order = (position + 1) * 10
        ProjectTask.objects.bulk_update(tasks.values(), ["order"])

        return Response({"ids": wanted})

    @action(detail=True, methods=["get"])
    def activity(self, request, *args, **kwargs):
        task = self.get_object()
        return Response(
            TaskActivitySerializer(task.activity.select_related("actor"), many=True).data
        )

    @action(detail=False, methods=["get"])
    def metrics(self, request, *args, **kwargs):
        """One person's project work, as numbers — for their profile.

        **Yours by default, and somebody else's only if you manage people.**
        Without that rule this is a tool for colleagues to compare themselves
        against each other, which is not what it was asked for: the figures
        exist so HR and the owner can form a view, and they carry no verdict
        precisely because forming the view is a person's job.

        `since` narrows to a period. A review covers a quarter, and lifetime
        totals flatter whoever has been here longest.
        """
        from datetime import date as date_cls

        from employees.models import Employee
        from projects.metrics import employee_project_summary

        since = None
        raw_since = request.query_params.get("since")
        if raw_since:
            try:
                since = date_cls.fromisoformat(raw_since)
            except ValueError:
                return Response(
                    {"detail": "`since` must be a date, as YYYY-MM-DD."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        me = _requesting_employee(request.user)
        requested = request.query_params.get("employee")

        if requested is None or (me is not None and str(me.id) == requested):
            employee = me
        elif can(request.user, Perm.PEOPLE_VIEW) or is_workplace_manager(request.user):
            employee = Employee.objects.filter(pk=requested).first()
        else:
            return Response(
                {"detail": "You can only see your own figures."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if employee is None:
            # No employment record, or no such employee. Empty figures rather
            # than a 404: a profile page asking for them should render, not
            # break, and "nothing recorded" is the honest answer.
            return Response({"tasks": None, "projects": None, "open_tasks": [], "active_projects": []})

        summary = employee_project_summary(employee, since=since)
        return Response(
            {
                "employee": employee.id,
                "tasks": summary["tasks"],
                "projects": summary["projects"],
                "open_tasks": ProjectTaskSerializer(summary["open_tasks"], many=True).data,
                "active_projects": ProjectSerializer(summary["active_projects"], many=True).data,
            }
        )


class TaskCommentViewSet(AuditViewSetMixin, ModelViewSet):
    serializer_class = TaskCommentSerializer
    permission_classes = PERMISSION_CLASSES
    filter_backends = [django_filters.DjangoFilterBackend]
    filterset_fields = ["task"]

    def get_queryset(self):
        return TaskComment.objects.select_related("created_by")

    def destroy(self, request, *args, **kwargs):
        """Only your own, and only ever your own.

        A comment is somebody's words. Deleting another person's remark from a
        task's history is editing the record of a conversation, which is what
        the activity trail exists to prevent.
        """
        comment = self.get_object()
        if comment.created_by_id != request.user.id and not can(request.user, Perm.PEOPLE_ADMIN):
            return Response(status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)


class TaskAttachmentViewSet(
    AuditViewSetMixin,
    ListModelMixin,
    CreateModelMixin,
    DestroyModelMixin,
    GenericViewSet,
):
    """Files on a task.

    **No update.** Replacing the file behind an attachment would silently
    change what a comment thread was talking about — "see the attached spec"
    then refers to a document nobody in the conversation has read. Upload the
    new one and delete the old, so the history says a change happened.

    Reading follows the task: anyone in the company who can see the board can
    open what is pinned to it. Writing follows the same three-way rule as the
    task itself, checked against the parent project.
    """

    serializer_class = TaskAttachmentSerializer
    permission_classes = PERMISSION_CLASSES
    parser_classes = [MultiPartParser, FormParser]

    def _task_ct(self):
        return ContentType.objects.get_for_model(ProjectTask)

    def get_queryset(self):
        queryset = (
            Document.objects.filter(content_type=self._task_ct())
            .select_related("created_by")
            .order_by("-created_at")
        )
        # The `?task=` scoping applies to the *list* only. Listing every
        # attachment in the company is not a question anybody asks, and
        # answering it would leak which files hang off work the caller has no
        # reason to be reading about — but a detail route addresses one row by
        # id and carries no query string, so filtering it here would 404 every
        # download and delete.
        if self.action != "list":
            return queryset
        task_id = self.request.query_params.get("task")
        if task_id is None:
            return queryset.none()
        return queryset.filter(object_id=task_id)

    def _may_write(self, task):
        # The same rule the task viewset applies — see `may_write_task`. This
        # was a second copy of it, which is how the two drifted apart once
        # already.
        return may_write_task(self.request.user, task)

    def perform_create(self, serializer):
        task = ProjectTask.objects.select_related("project").get(
            pk=serializer.validated_data.pop("task")
        )
        if not self._may_write(task):
            raise PermissionDenied("That task is not yours to change.")

        uploaded = self.request.data.get("file")
        serializer.save(
            content_type=self._task_ct(),
            object_id=task.id,
            kind=Document.Kind.ATTACHMENT,
            original_filename=getattr(uploaded, "name", ""),
            created_by=self.request.user,
            updated_by=self.request.user,
        )

    def destroy(self, request, *args, **kwargs):
        """Your own, or the project's to manage.

        An assignee may remove a file they attached in error. Removing somebody
        else's is editing the record of what was shared, which is the same
        objection that keeps them from deleting another person's comment.
        """
        attachment = self.get_object()
        task = ProjectTask.objects.select_related("project").filter(
            pk=attachment.object_id
        ).first()
        own_upload = attachment.created_by_id == request.user.id
        manages = task is not None and (
            is_workplace_manager(request.user) or owns_project(request.user, task.project)
        )
        if not (own_upload or manages):
            return Response(status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["get"])
    def download(self, request, *args, **kwargs):
        attachment = self.get_object()
        if not attachment.file:
            raise Http404("File missing.")
        return FileResponse(
            attachment.file.open("rb"),
            as_attachment=True,
            filename=attachment.original_filename or attachment.file.name.split("/")[-1],
        )
