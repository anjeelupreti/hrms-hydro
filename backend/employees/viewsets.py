from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from django_filters import rest_framework as django_filters
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin
from rest_framework.permissions import SAFE_METHODS, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet, ModelViewSet

from accounts.permissions import IsHRAdmin, IsHRAdminOrReadOnly
from accounts.serializers import EmployeeExperienceSerializer
from accounts.policy import Perm, can
from attendance.permissions import _requesting_employee
from core.exports import XlsxExportMixin, xlsx_response
from core.filters import IdsLookupMixin
from core.viewsets import AuditViewSetMixin
from employees import services
from notifications.services import notify
from employees.suspensions import SuspensionError
from employees.suspensions import lift as lift_suspension
from employees.suspensions import suspend
from employees.imports import (
    EXAMPLE_ROW,
    GENDER_CHOICES,
    STATUS_CHOICES,
    TEMPLATE_HEADERS,
)
from employees.imports import (
    import_employees as import_employees_from_workbook,
    preview_employees,
)
from employees.models import (
    EmployeeExperience,
    Award,
    CorporatePost,
    CorporateRole,
    DisciplinaryAction,
    Suspension,
    Department,
    Dependant,
    Designation,
    EducationRecord,
    EmergencyContact,
    Employee,
    LifecycleApprovalAction,
    LifecycleEvent,
    Nominee,
    Signature,
)
from employees.offboarding import outstanding_items
from employees.scoping import scope_to_visible
from employees.serializers import (
    EmployeeExperienceAdminSerializer,
    AwardSerializer,
    CorporatePostSerializer,
    CorporateRoleSerializer,
    DisciplinaryActionSerializer,
    LiftSuspensionSerializer,
    SuspensionSerializer,
    DecisionSerializer,
    DepartmentSerializer,
    DependantSerializer,
    DesignationSerializer,
    EducationRecordSerializer,
    EmergencyContactSerializer,
    EmployeeDetailSerializer,
    EmployeeListSerializer,
    EmployeeLogSerializer,
    EmployeeWriteSerializer,
    LifecycleApprovalActionSerializer,
    LifecycleEventCreateSerializer,
    LifecycleEventSerializer,
    NomineeSerializer,
    SignatureSerializer,
)


class DepartmentViewSet(IdsLookupMixin, AuditViewSetMixin, ModelViewSet):
    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "code"]
    ordering_fields = ["name"]
    ordering = ["name"]


class DesignationViewSet(IdsLookupMixin, AuditViewSetMixin, ModelViewSet):
    queryset = Designation.objects.select_related("department").all()
    serializer_class = DesignationSerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_fields = ["department"]
    search_fields = ["title"]
    ordering_fields = ["title"]
    ordering = ["title"]


class EmployeeFilterSet(django_filters.FilterSet):
    #: "Everyone who works at this company", primary or seconded — which is the
    #: question a site manager asks, and neither field answers alone.
    company = django_filters.NumberFilter(method="filter_company")

    class Meta:
        model = Employee
        fields = [
            "department",
            "designation",
            "employment_status",
            "primary_company",
            "secondary_companies",
        ]

    def filter_company(self, queryset, name, value):
        return queryset.filter(
            Q(primary_company_id=value) | Q(secondary_companies__id=value)
        ).distinct()


class EmployeeViewSet(IdsLookupMixin, XlsxExportMixin, AuditViewSetMixin, ModelViewSet):
    # `manager__user` is joined for the list serializer's `manager_name`;
    # without it the roster fires one query per employee to name a manager.
    queryset = Employee.objects.select_related(
        "user", "department", "designation", "manager", "manager__user", "primary_company"
    ).prefetch_related("secondary_companies")
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_class = EmployeeFilterSet
    search_fields = ["employee_code", "user__first_name", "user__last_name", "user__email"]
    ordering_fields = ["employee_code", "date_joined", "employment_status"]

    #: People who have left. Not archived — *departed*.
    #:
    #: Held out of the default directory listing so counts, filters and
    #: exports describe the current workforce rather than everyone who has ever
    #: worked here.
    #:
    #: Deliberately not `archived_at`. `employment_status` already says somebody
    #: has left, and a second field saying the same thing is two answers to one
    #: question that will eventually disagree. The archive used elsewhere exists
    #: for rows that have *no* state saying they are finished; an employee
    #: record has one, so the vault is a view over it rather than a new flag.
    DEPARTED = ("resigned", "terminated")

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)

        # Only the roster. A detail lookup must still reach a leaver — their
        # record, payslips and documents outlive their employment, and the
        # `unarchive` 404 on the other lists was exactly this mistake.
        if getattr(self, "action", None) != "list":
            return queryset

        # An explicit status filter is somebody asking for that bucket by name;
        # honour it rather than second-guessing. This is what keeps the
        # "Terminated" chip working.
        if self.request.query_params.get("employment_status"):
            return queryset

        past = str(self.request.query_params.get("past", "")).lower()
        if past in ("1", "true", "yes"):
            return queryset.filter(employment_status__in=self.DEPARTED)
        if past in ("all", "any"):
            return queryset
        return queryset.exclude(employment_status__in=self.DEPARTED)

    def get_serializer_class(self):
        if self.action == "list":
            return EmployeeListSerializer
        if self.action in ("create", "update", "partial_update"):
            return EmployeeWriteSerializer
        return EmployeeDetailSerializer

    def _respond_with_detail(self, instance, status_code):
        detail = EmployeeDetailSerializer(instance, context=self.get_serializer_context())
        return Response(detail.data, status=status_code)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return self._respond_with_detail(serializer.instance, status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def rehire(self, request, *args, **kwargs):
        """Bring a former employee back on the same record — D23.

        Available on **anybody who has left**, which is the point: a rejoiner
        is a normal event and hunting for a database console is not a process.
        """
        from datetime import date as date_cls

        from employees.services import RehireError, rehire

        if not can(request.user, Perm.PEOPLE_MANAGE):
            return Response(status=status.HTTP_403_FORBIDDEN)

        raw = request.data.get("date_joined")
        try:
            joined = date_cls.fromisoformat(raw) if raw else None
        except ValueError:
            return Response(
                {"date_joined": "Dates must be YYYY-MM-DD."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            employee = rehire(self.get_object(), request.user, date_joined=joined)
        except RehireError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return self._respond_with_detail(employee, status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return self._respond_with_detail(serializer.instance, status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="status-counts", pagination_class=None)
    def status_counts(self, request, *args, **kwargs):
        """Headcount per employment status, for the directory's filter chips.

        Counted server-side over the whole visible directory. Counting in the
        browser would only ever describe the page in hand — on a company past
        the page cap the chips would confidently show the wrong totals, which
        is worse than showing none.

        Deliberately ignores the status filter itself: the chips have to keep
        saying how many are in each bucket *while* one bucket is selected, or
        selecting "Active" would zero every other number.
        """
        queryset = self.get_queryset()
        # Honour the other filters — a department picked above should narrow
        # these counts, or the chips disagree with the rows beneath them.
        for field in ("department", "designation"):
            value = request.query_params.get(field)
            if value and value.isdigit():
                queryset = queryset.filter(**{field: int(value)})
        # Company is the same idea and not the same query: "everyone who works
        # here" spans the payroll and the secondments, so it goes through the
        # filterset's own method rather than a plain equality on one column.
        company = request.query_params.get("company")
        if company and company.isdigit():
            queryset = queryset.filter(
                Q(primary_company_id=int(company)) | Q(secondary_companies__id=int(company))
            ).distinct()
        search = request.query_params.get("search")
        if search:
            queryset = filters.SearchFilter().filter_queryset(request, queryset, self)

        rows = queryset.values("employment_status").annotate(n=Count("id"))
        counts = {row["employment_status"]: row["n"] for row in rows}
        return Response(
            {
                "total": sum(counts.values()),
                **{choice: counts.get(choice, 0) for choice, _ in Employee.EmploymentStatus.choices},
            }
        )

    @action(detail=False, methods=["get"], url_path="import-template")
    def import_template(self, request, *args, **kwargs):
        """Download the styled .xlsx template (one example row + dropdowns
        for gender/status). Read-open, but only HR would use it."""
        return xlsx_response(
            "employee-import-template.xlsx",
            TEMPLATE_HEADERS,
            [EXAMPLE_ROW],
            title="Employee Import Template",
            subtitle="Add one employee per row below the example. Email is required; dates use YYYY-MM-DD.",
            validations={6: GENDER_CHOICES, 8: STATUS_CHOICES},
        )

    @action(detail=False, methods=["post"], url_path="import-employees")
    def bulk_import(self, request, *args, **kwargs):
        """HR-only bulk import (write action → IsHRAdminOrReadOnly enforces
        HR). Returns a per-row result summary; a bad row is reported, not
        fatal to the batch."""
        file_obj = request.FILES.get("file")
        if file_obj is None:
            return Response({"detail": "No file uploaded."}, status=status.HTTP_400_BAD_REQUEST)
        # The rows somebody chose in the preview, if they came through it.
        # Sent as a comma-separated field because the file rides in the same
        # multipart request and JSON cannot.
        raw = request.data.get("rows")
        rows = None
        if raw:
            rows = [int(n) for n in str(raw).split(",") if n.strip().isdigit()]

        try:
            summary = import_employees_from_workbook(file_obj, actor=request.user, rows=rows)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(summary)

    @action(detail=False, methods=["post"], url_path="import-preview")
    def import_preview(self, request, *args, **kwargs):
        """Read an uploaded workbook and describe what it would do. Creates nothing.

        Separate from the import itself so the screen can show the rows, mark
        the ones that cannot be created, and let somebody choose which people
        actually come in.
        """
        file_obj = request.FILES.get("file")
        if file_obj is None:
            return Response({"detail": "No file uploaded."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            return Response(preview_employees(file_obj))
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["get"])
    def activity(self, request, *args, **kwargs):
        """What this person has been *doing*, across the modules they use.

        The feed the profile's Activity tab draws: leave asked for, hours
        logged, expenses claimed, training finished, tasks closed. Deliberately
        *not* `EmployeeLog` — that is an audit trail of edits made to somebody's
        record, and it is already shown twice elsewhere (Record history on the
        employee page, and the position timeline). Nobody opens their own
        profile to find out which of their fields an administrator touched.

        **Each source is capped before merging, not after.** Somebody logs
        timesheets every day and resigns once; taking the newest 40 rows
        overall would be forty timesheet entries and nothing else, which is a
        feed that hides everything except the noisiest module.

        🔒 **Gated here, explicitly — `get_object()` is not enough.** This
        viewset is the staff directory: every employee may look up every
        colleague, which is correct for a name, a department and a desk phone.
        It is *not* correct for the leave somebody took, the expenses they
        claimed or the hours they logged, and leaning on `get_object()` — as the
        first version of this did — published all three to the whole company.
        The test that caught it is the same shape as the one on the attendance
        summary, and it caught a real leak rather than a phantom.

        Answers 404 rather than 403: whether a colleague has a feed is not a
        thing to confirm to somebody who may not read it.
        """
        from employees.scoping import is_people_admin, requesting_employee

        employee = self.get_object()

        viewer = requesting_employee(request.user)
        allowed = (
            is_people_admin(request.user)
            or (viewer is not None and viewer.pk == employee.pk)
            or (viewer is not None and employee.manager_id == viewer.pk)
        )
        if not allowed:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        per_source = 6
        events = []

        def add(when, kind, text):
            # Dates and datetimes both arrive here; the feed sorts on one axis,
            # so everything is reduced to a date. A time of day is not worth
            # the ambiguity of comparing the two types.
            if when is None:
                return
            events.append(
                {
                    "date": (when.date() if hasattr(when, "date") else when).isoformat(),
                    "kind": kind,
                    "text": text,
                }
            )

        from leave.models import LeaveRequest

        for row in (
            LeaveRequest.objects.filter(employee=employee)
            .select_related("leave_type")
            .order_by("-start_date")[:per_source]
        ):
            days = row.days_requested
            add(
                row.start_date,
                "leave",
                f"{row.get_status_display()} — {days} day{'s' if days != 1 else ''} of "
                f"{row.leave_type.name if row.leave_type else 'leave'}",
            )

        from timesheets.models import TimeEntry

        for row in (
            TimeEntry.objects.filter(employee=employee)
            .select_related("project")
            .order_by("-date")[:per_source]
        ):
            add(
                row.date,
                "timesheet",
                f"Logged {row.hours}h on {row.project.name if row.project else 'a project'}",
            )

        from expenses.models import ExpenseClaim

        for row in ExpenseClaim.objects.filter(employee=employee).order_by("-expense_date")[
            :per_source
        ]:
            add(row.expense_date, "expense", f"{row.get_status_display()} — {row.title}")

        from training.models import Enrollment

        for row in (
            Enrollment.objects.filter(employee=employee)
            .select_related("session__program")
            .order_by("-id")[:per_source]
        ):
            session = getattr(row, "session", None)
            program = getattr(session, "program", None)
            add(
                getattr(session, "start_datetime", None) or getattr(session, "start_date", None),
                "training",
                f"{row.get_status_display()} — {program.title if program else 'training'}",
            )

        from projects.models import ProjectTask

        for row in (
            ProjectTask.objects.filter(
                assignee=employee, status=ProjectTask.Status.DONE, completed_at__isnull=False
            )
            .select_related("project")
            .order_by("-completed_at")[:per_source]
        ):
            add(row.completed_at, "task", f"Finished “{row.title}”")

        # The lifecycle events stay — a promotion is something that happened to
        # somebody's career, not an edit to a field, and it belongs in a feed of
        # their time here.
        for row in employee.lifecycle_events.filter(status="applied").order_by("-effective_date")[
            :per_source
        ]:
            add(row.effective_date, "lifecycle", row.get_event_type_display())

        events.sort(key=lambda e: e["date"], reverse=True)
        return Response(events[:24])

    @action(detail=True, methods=["get"])
    def logs(self, request, *args, **kwargs):
        """Lifecycle history: status changes (incl. terminations) and
        department/designation/manager reassignments, newest first."""
        employee = self.get_object()
        serializer = EmployeeLogSerializer(employee.logs.select_related("actor"), many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="org-chart")
    def org_chart(self, request, *args, **kwargs):
        """The reporting hierarchy as a nested tree, built from each
        employee's `manager`. Roots are people with no manager (or whose
        manager is inactive/missing). Read-only — derived from existing data,
        no separate org-structure model to keep in sync."""
        emps = Employee.objects.select_related("user", "department", "designation").exclude(
            employment_status__in=[
                Employee.EmploymentStatus.RESIGNED,
                Employee.EmploymentStatus.TERMINATED,
            ]
        )
        nodes = {}
        for e in emps:
            nodes[e.id] = {
                "id": e.id,
                "name": e.user.get_full_name() or e.user.get_username(),
                "employee_code": e.employee_code,
                "designation": e.designation.title if e.designation else None,
                # Seniority of the *post*, not the depth of the branch. An org
                # chart drawn only from `manager` puts two peers at different
                # levels whenever their branches differ in length; rank is what
                # lets the client lay them out as peers when asked to.
                "rank": e.designation.rank if e.designation else 0,
                "department": e.department.name if e.department else None,
                "department_id": e.department_id,
                "photo": e.photo.url if e.photo else None,
                "manager": e.manager_id,
                "children": [],
            }
        # Leavers are excluded from the chart, but their reports still carry a
        # `manager_id` pointing at them — so without this those people would all
        # become roots and the hierarchy would flatten to one level.
        #
        # Somebody whose manager has left reports to *their* manager until they
        # are reassigned, which is what actually happens. Walked all the way up,
        # because a whole management layer can leave at once, and cycle-guarded
        # because `manager` is a self-FK with nothing stopping A → B → A.
        all_managers = dict(
            Employee.objects.values_list("id", "manager_id")
        )

        def living_manager(employee_id):
            seen = {employee_id}
            candidate = all_managers.get(employee_id)
            while candidate is not None and candidate not in nodes:
                if candidate in seen:
                    return None
                seen.add(candidate)
                candidate = all_managers.get(candidate)
            return candidate

        roots = []
        for node in nodes.values():
            mgr = node["manager"]
            if mgr is not None and mgr not in nodes:
                # Re-parented onto the nearest manager who is still here.
                mgr = living_manager(node["id"])
                node["reports_to_departed"] = True
            if mgr is not None and mgr in nodes:
                nodes[mgr]["children"].append(node)
            else:
                roots.append(node)
        # Siblings by seniority first, then name. Rank 0 is unranked and sorts
        # last — `or 10**6` rather than a NULLS-LAST clause, because 0 is a real
        # stored value here and not an absence.
        def sibling_key(n):
            return (n["rank"] or 10**6, n["name"].lower())

        for node in nodes.values():
            node["children"].sort(key=sibling_key)
        roots.sort(key=sibling_key)

        # The second projection: the tree alone cannot answer "show me this by
        # department", because reporting lines cross departments constantly — a
        # finance manager reporting to a COO sits under Operations in the tree.
        # Grouping client-side would mean walking the tree and losing the
        # hierarchy, so both views are served from the one query.
        departments = {}
        for node in nodes.values():
            key = node["department_id"] or 0
            bucket = departments.setdefault(
                key,
                {
                    "id": node["department_id"],
                    "name": node["department"] or "Unassigned",
                    "people": [],
                },
            )
            # Flat within a department, ordered by seniority — that is the
            # question "who is senior here", which the tree answers badly.
            bucket["people"].append(
                {k: v for k, v in node.items() if k != "children"}
            )
        for bucket in departments.values():
            bucket["people"].sort(key=sibling_key)

        return Response({
            "tree": roots,
            "departments": sorted(
                departments.values(),
                key=lambda d: (d["name"] == "Unassigned", d["name"].lower()),
            ),
        })

    export_filename = "employees.xlsx"
    export_title = "Employees"
    export_headers = ["Code", "Name", "Email", "Phone", "Department", "Designation", "Status", "Joined"]
    export_highlight_header = "Status"
    export_validations = {"Status": ["Active", "On Leave", "Resigned", "Terminated"]}

    def get_export_rows(self, queryset):
        return [
            [
                e.employee_code,
                e.user.get_full_name() or e.user.get_username(),
                e.user.email,
                e.phone,
                e.department.name if e.department else "",
                e.designation.title if e.designation else "",
                e.get_employment_status_display(),
                e.date_joined.isoformat() if e.date_joined else "",
            ]
            for e in queryset.select_related("user", "department", "designation")
        ]

    @action(detail=True, methods=["get"])
    def profile(self, request, *args, **kwargs):
        """Read-only public-ish profile of a colleague — what any
        authenticated teammate sees when they click a name in a table. No
        audit activity or self-editable-only bits; just directory + about."""
        emp = self.get_object()
        user = emp.user
        return Response(
            {
                "id": emp.id,
                "user_id": emp.user_id,
                "full_name": user.get_full_name() or user.get_username(),
                "employee_code": emp.employee_code,
                "email": user.email,
                "role": user.role,
                "phone": emp.phone,
                "photo": emp.photo.url if emp.photo else None,
                "cover_image": emp.cover_image.url if emp.cover_image else None,
                # Served everywhere the cover is, or the banner centres itself
                # on three of the four surfaces and the crop looks like it did
                # not save.
                "cover_position": emp.cover_position or "50% 50%",
                "bio": emp.bio,
                "address": emp.address,
                "city": emp.city,
                "country": emp.country,
                "skills": emp.skills or [],
                "date_joined": emp.date_joined,
                "employment_status": emp.employment_status,
                "department_name": emp.department.name if emp.department else None,
                "designation_title": emp.designation.title if emp.designation else None,
                "manager_name": (
                    (emp.manager.user.get_full_name() or emp.manager.user.get_username())
                    if emp.manager
                    else None
                ),
                "manager_id": emp.manager_id,
                # Through the serializer rather than a dict literal — see the
                # matching note in `accounts.serializers.MyProfileSerializer`.
                "experiences": EmployeeExperienceSerializer(
                    emp.experiences.all(), many=True
                ).data,
            }
        )


class LifecycleEventViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    """Promotion/Award/Resignation/Termination/Transfer — first-class
    workflows with effective dates and (except Award) HR approval, rather
    than a raw PATCH to Employee fields. See employees/services.py."""

    serializer_class = LifecycleEventSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [django_filters.DjangoFilterBackend]
    filterset_fields = ["employee", "event_type", "status"]

    def get_queryset(self):
        qs = LifecycleEvent.objects.select_related(
            "employee__user", "new_designation", "new_department", "new_manager__user"
        )
        return scope_to_visible(qs, self.request.user)

    def create(self, request, *args, **kwargs):
        serializer = LifecycleEventCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        is_hr = can(request.user, Perm.PEOPLE_MANAGE)
        employee = None
        requested_employee_id = request.data.get("employee")
        if is_hr and requested_employee_id:
            employee = Employee.objects.filter(pk=requested_employee_id).first()
        elif not is_hr:
            employee = _requesting_employee(request.user)
        if employee is None:
            return Response(
                {"employee": "Not found, or your account has no employee profile."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        event = services.submit_lifecycle_event(employee, actor=request.user, **data)
        return Response(LifecycleEventSerializer(event).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="pending-approval")
    def pending_approval(self, request, *args, **kwargs):
        is_hr = can(request.user, Perm.PEOPLE_MANAGE)
        if not is_hr:
            return Response(status=status.HTTP_403_FORBIDDEN)
        qs = self.get_queryset().filter(status=LifecycleEvent.Status.PENDING_APPROVAL)
        return Response(LifecycleEventSerializer(qs, many=True).data)

    def _require_hr(self, request):
        return can(request.user, Perm.PEOPLE_MANAGE)

    @action(detail=True, methods=["post"])
    def approve(self, request, *args, **kwargs):
        if not self._require_hr(request):
            return Response(status=status.HTTP_403_FORBIDDEN)
        event = self.get_object()
        serializer = DecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            event = services.decide(
                event, request.user, LifecycleApprovalAction.Decision.APPROVED, serializer.validated_data["comment"]
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(LifecycleEventSerializer(event).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, *args, **kwargs):
        if not self._require_hr(request):
            return Response(status=status.HTTP_403_FORBIDDEN)
        event = self.get_object()
        serializer = DecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            event = services.decide(
                event, request.user, LifecycleApprovalAction.Decision.REJECTED, serializer.validated_data["comment"]
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(LifecycleEventSerializer(event).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, *args, **kwargs):
        event = self.get_object()
        employee = _requesting_employee(request.user)
        is_owner = employee is not None and event.employee_id == employee.id
        if not (is_owner or self._require_hr(request)):
            return Response(status=status.HTTP_403_FORBIDDEN)
        try:
            event = services.cancel(event, request.user)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(LifecycleEventSerializer(event).data)

    @action(detail=True, methods=["get"])
    def actions(self, request, *args, **kwargs):
        event = self.get_object()
        serializer = LifecycleApprovalActionSerializer(event.actions.select_related("actor"), many=True)
        return Response(serializer.data)


class _EmployeeRecordViewSet(AuditViewSetMixin, ModelViewSet):
    """Shared base for the lists that hang off one employee.

    **Scoped to a person, always.** `?employee=` selects whose records these
    are, and `get_queryset` refuses anybody who may not see that person — so
    the four viewsets below cannot each get the visibility rule slightly
    different, which is how one of them ends up publishing somebody's next of
    kin to the whole company.
    """

    permission_classes = [IsAuthenticated]
    model = None

    def _target_employee(self):
        """Whose records are being asked for — theirs by default."""
        requested = self.request.query_params.get("employee") or self.request.data.get("employee")
        own = getattr(self.request.user, "employee", None)
        if not requested:
            return own
        if str(requested).isdigit():
            return Employee.objects.filter(pk=int(requested)).first()
        return own

    def get_queryset(self):
        """Everything this caller may see, then narrowed by `?employee=`.

        Built in that order deliberately. Scoping to the *requested* employee
        first and checking afterwards meant a detail route with no query
        parameter fell back to the caller's own records — so HR opening
        somebody else's qualification got a 404 on a record that plainly
        exists.

        Anyone with no claim gets an empty list rather than a 403: the
        existence of somebody's next of kin is itself information they did not
        agree to publish, and a refusal confirms there is something there.
        """
        user = self.request.user
        own = getattr(user, "employee", None)
        qs = self.model.objects.select_related("employee__user")

        if not can(user, Perm.PEOPLE_MANAGE):
            visible_ids = set()
            if own is not None:
                visible_ids.add(own.pk)
                # A manager sees their own team's, the same reach they have
                # everywhere else — capability and scope stay separate axes.
                visible_ids.update(
                    Employee.objects.filter(manager=own).values_list("pk", flat=True)
                )
            qs = qs.filter(employee_id__in=visible_ids)

        requested = self.request.query_params.get("employee")
        if requested and str(requested).isdigit():
            qs = qs.filter(employee_id=int(requested))
        return qs

    def perform_create(self, serializer):
        employee = self._target_employee()
        own = getattr(self.request.user, "employee", None)
        is_self = own is not None and employee is not None and own.pk == employee.pk
        if employee is None or not (is_self or can(self.request.user, Perm.PEOPLE_MANAGE)):
            raise PermissionDenied("You cannot add records for this employee.")
        serializer.save(employee=employee, created_by=self.request.user, updated_by=self.request.user)

    def get_serializer_context(self):
        # The nominee serializer needs the employee to total the shares.
        return {**super().get_serializer_context(), "employee": self._target_employee()}


class EmergencyContactViewSet(_EmployeeRecordViewSet):
    serializer_class = EmergencyContactSerializer
    model = EmergencyContact

    def perform_create(self, serializer):
        super().perform_create(serializer)
        self._demote_others(serializer.instance)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)
        self._demote_others(serializer.instance)

    def _demote_others(self, contact):
        """Exactly one primary, enforced here rather than by a constraint.

        A unique constraint would make *deleting* the primary contact fail,
        which is the moment somebody most needs to edit the list.
        """
        if not contact.is_primary:
            return
        EmergencyContact.objects.filter(employee=contact.employee).exclude(
            pk=contact.pk
        ).update(is_primary=False)


class DependantViewSet(_EmployeeRecordViewSet):
    serializer_class = DependantSerializer
    model = Dependant


class NomineeViewSet(_EmployeeRecordViewSet):
    serializer_class = NomineeSerializer
    model = Nominee


class EducationRecordViewSet(_EmployeeRecordViewSet):
    serializer_class = EducationRecordSerializer
    model = EducationRecord

    @action(detail=True, methods=["post"])
    def verify(self, request, *args, **kwargs):
        """HR has seen the certificate.

        Its own action rather than a writable field: verification is a claim
        *about* the record made by somebody other than its subject, and a
        writable `verified_at` would let the person being verified set it.
        """
        if not can(request.user, Perm.PEOPLE_MANAGE):
            raise PermissionDenied("Only HR can verify a qualification.")

        record = self.get_object()
        record.verified_at = timezone.now()
        record.verified_by = request.user
        record.save(update_fields=["verified_at", "verified_by", "updated_at"])
        return Response(self.get_serializer(record).data)

    @action(detail=True, methods=["post"], url_path="unverify")
    def unverify(self, request, *args, **kwargs):
        """R2: anything you can assert, you must be able to take back — a
        verification made in error otherwise stands forever."""
        if not can(request.user, Perm.PEOPLE_MANAGE):
            raise PermissionDenied("Only HR can withdraw a verification.")

        record = self.get_object()
        record.verified_at = None
        record.verified_by = None
        record.save(update_fields=["verified_at", "verified_by", "updated_at"])
        return Response(self.get_serializer(record).data)


class OffboardingSummaryView(APIView):
    """What is still open between a leaver and the company.

    Assembled live from the modules that own each fact rather than copied into
    a leavers' table: a snapshot taken at resignation goes stale the moment
    somebody returns a laptop, and a stale exit statement is worse than none
    because it gets acted on.

    Deliberately **not** a settlement figure. Payroll owns money, and a second
    place that adds up a last payment is a second answer to a question that
    must have exactly one.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk, **kwargs):
        employee = Employee.objects.filter(pk=pk).select_related("user").first()
        if employee is None:
            raise NotFound("No such employee.")

        own = getattr(request.user, "employee", None)
        is_self = own is not None and own.pk == employee.pk
        if not (is_self or can(request.user, Perm.PEOPLE_MANAGE)):
            raise PermissionDenied("You cannot see this employee's exit summary.")

        return Response(outstanding_items(employee))


# ── The lookups behind post and role ─────────────────────────────────────


class CorporatePostViewSet(AuditViewSetMixin, ModelViewSet):
    """Establishment positions — the chairs people are appointed to.

    Readable by anyone signed in: a colleague's profile names their post, and
    hiding the list would only render it as a number. Writing needs
    `settings.manage`, and creating or deleting additionally needs an admin
    role — the same split every other lookup gets.
    """

    serializer_class = CorporatePostSerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]
    required_permission = Perm.SETTINGS_MANAGE
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "code"]
    ordering_fields = ["rank", "name", "code"]
    # Named on the view, not left to `Meta.ordering`: `OrderingFilter` leaves an
    # annotated queryset unordered when the view declares no default, and
    # paging an unordered list is how one row shows up on two pages.
    ordering = ["rank", "name"]

    def get_queryset(self):
        return CorporatePost.objects.annotate(employee_count=Count("employees", distinct=True))


class CorporateRoleViewSet(AuditViewSetMixin, ModelViewSet):
    """What people are actually responsible for. See `CorporatePostViewSet`."""

    serializer_class = CorporateRoleSerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]
    required_permission = Perm.SETTINGS_MANAGE
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_fields = ["company", "is_active"]
    search_fields = ["name", "code"]
    ordering_fields = ["name", "code"]
    ordering = ["name"]

    def get_queryset(self):
        return CorporateRole.objects.select_related("company").annotate(
            employee_count=Count("employees", distinct=True)
        )


# ── Suspension ───────────────────────────────────────────────────────────


class SuspensionViewSet(AuditViewSetMixin, ModelViewSet):
    """Who is locked out, since when, and how it ended.

    **Creating one goes through `employees.suspensions.suspend`** rather than
    through the serializer's `save`, because recording the row is only a third
    of the job: the employment status and the account's own `is_active` flag
    move with it, and a viewset that wrote just the row would leave a person
    marked suspended and still able to sign in.

    **Ending one is an action, not a PATCH**, for the same reason and one more:
    an outcome is required. "The suspension is over" and "the suspension became
    a dismissal" are different facts, and a nullable field on an update lets
    the second be recorded as the first by omission.

    An employee sees their own — being told you are suspended is not optional —
    and nobody else's.
    """

    serializer_class = SuspensionSerializer
    permission_classes = [IsAuthenticated, IsHRAdmin]
    required_permission = Perm.PEOPLE_MANAGE
    filter_backends = [django_filters.DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["employee", "is_active", "outcome"]
    ordering_fields = ["starts_on", "ends_on"]

    def get_permissions(self):
        # Reading your own is not an HR act. The queryset below is what limits
        # it to your own; this only stops `IsHRAdmin` refusing the request
        # before the queryset is consulted.
        if self.request.method in SAFE_METHODS:
            return [IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        qs = Suspension.objects.select_related("employee__user", "lifted_by")
        if can(self.request.user, Perm.PEOPLE_MANAGE):
            return qs
        own = getattr(self.request.user, "employee", None)
        return qs.filter(employee=own) if own else qs.none()

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        employee = serializer.validated_data["employee"]
        try:
            suspension = suspend(
                employee,
                starts_on=serializer.validated_data["starts_on"],
                ends_on=serializer.validated_data.get("ends_on"),
                reason=serializer.validated_data["reason"],
                actor=request.user,
            )
        except SuspensionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            self.get_serializer(suspension).data, status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=["post"])
    def lift(self, request, *args, **kwargs):
        """End it, and say how."""
        suspension = self.get_object()
        if not suspension.is_active and suspension.outcome != Suspension.Outcome.PENDING:
            return Response(
                {"detail": "This suspension has already been closed."},
                status=status.HTTP_409_CONFLICT,
            )
        form = LiftSuspensionSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        try:
            lift_suspension(
                suspension,
                outcome=form.validated_data["outcome"],
                note=form.validated_data.get("note", ""),
                actor=request.user,
            )
        except SuspensionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        suspension.refresh_from_db()
        return Response(self.get_serializer(suspension).data)


# ── Recognition, and its opposite ────────────────────────────────────────


class _EmployeeHRRecordViewSet(AuditViewSetMixin, ModelViewSet):
    """A per-employee list that only HR writes.

    Distinct from `_EmployeeRecordViewSet`, which lets somebody maintain their
    own next of kin. An award and a written warning are both things the company
    records *about* a person: they may read their own — a disciplinary file
    nobody is allowed to see is not due process — and may not write either.
    """

    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]
    required_permission = Perm.PEOPLE_MANAGE
    model = None

    def get_queryset(self):
        qs = self.model.objects.select_related("employee__user")
        if not can(self.request.user, Perm.PEOPLE_MANAGE):
            own = getattr(self.request.user, "employee", None)
            qs = qs.filter(employee=own) if own else qs.none()
        requested = self.request.query_params.get("employee")
        if requested and str(requested).isdigit():
            qs = qs.filter(employee_id=int(requested))
        return qs


class EmployeeExperienceViewSet(_EmployeeHRRecordViewSet):
    """Work history, from HR's side.

    **The gap this closes.** Experience was reachable only through
    `accounts/experiences/`, which is strictly self-scoped — the docstring there
    says "you can't touch anyone else's" — so HR could *read* somebody's work
    history in the profile payload and could not correct a typo in it, add the
    internal post it had just promoted them into, or set `is_verified` after
    checking the certificate. That last one is the sharpest: the flag exists
    precisely for HR to confirm a self-declared claim against a document, and
    the only people who could write it were the people making the claim.

    Employees keep their own endpoint for their own entries. This one is the
    other half: HR maintains anybody's, and `is_verified` is writable here and
    nowhere else.
    """

    serializer_class = EmployeeExperienceAdminSerializer
    model = EmployeeExperience
    filter_backends = [django_filters.DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["employee", "kind", "is_verified"]
    ordering_fields = ["start_year", "end_year"]
    # Newest first, and named explicitly: the model's own ordering is by
    # `-start_year`, and an annotated or filtered queryset without an explicit
    # ordering is what raises `UnorderedObjectListWarning` under pagination.
    ordering = ["-start_year", "-id"]


class AwardViewSet(_EmployeeHRRecordViewSet):
    serializer_class = AwardSerializer
    model = Award
    filter_backends = [django_filters.DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["employee", "kind"]
    ordering_fields = ["awarded_on"]


class DisciplinaryActionViewSet(_EmployeeHRRecordViewSet):
    serializer_class = DisciplinaryActionSerializer
    model = DisciplinaryAction
    filter_backends = [django_filters.DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["employee", "severity", "status"]
    ordering_fields = ["issued_on", "incident_date"]

    def get_queryset(self):
        return super().get_queryset().select_related("suspension")


class SignatureViewSet(AuditViewSetMixin, ModelViewSet):
    """Uploading a signature, and somebody else saying it may be used.

    **Two different people, deliberately.** The employee provides the image —
    it is theirs and nobody else should be drawing it — and somebody holding
    `people.manage` approves it. A memorandum printed with the signatures of
    the people who recommended it is only a record if those signatures were
    checked by a second pair of eyes; self-approval would make the whole
    apparatus decorative.

    Everybody sees their own. Only somebody who may manage people sees
    everybody's, which is what the approval queue needs.
    """

    serializer_class = SignatureSerializer
    permission_classes = [IsAuthenticated]
    # **`?status=pending` has to actually filter.** The approval queue asks for
    # pending rows; without this the parameter was ignored and the queue listed
    # every signature there had ever been — so approving one left it sitting in
    # the list of things to approve, now marked approved.
    filter_backends = [django_filters.DjangoFilterBackend]
    filterset_fields = ["status", "employee"]

    def get_queryset(self):
        qs = Signature.objects.select_related("employee__user", "decided_by")
        if can(self.request.user, Perm.PEOPLE_MANAGE):
            return qs
        me = getattr(self.request.user, "employee", None)
        return qs.filter(employee=me) if me else qs.none()

    def perform_create(self, serializer):
        """Always your own, whatever the payload says.

        `employee` is on the serializer because the field has to exist for the
        response; taking it from the request would let anybody upload a
        signature in somebody else's name, which is the one thing this model
        exists to make hard.
        """
        me = getattr(self.request.user, "employee", None)
        if me is None:
            raise ValidationError("Your account has no employee record to sign for.")
        serializer.save(
            employee=me,
            status=Signature.Status.PENDING,
            created_by=self.request.user,
            updated_by=self.request.user,
        )

    @action(detail=True, methods=["post"])
    def approve(self, request, *args, **kwargs):
        """Let it be used, and retire whichever one it replaces."""
        if not can(request.user, Perm.PEOPLE_MANAGE):
            return Response(status=status.HTTP_403_FORBIDDEN)
        signature = self.get_object()
        me = getattr(request.user, "employee", None)
        if me is not None and me.pk == signature.employee_id:
            return Response(
                {"detail": "A signature has to be approved by somebody other than its owner."},
                status=status.HTTP_403_FORBIDDEN,
            )

        with transaction.atomic():
            # Superseded rather than deleted: a memorandum signed last year was
            # signed with last year's image, and removing it would silently
            # restate history. The partial unique index allows exactly one
            # approved row, so the old one has to move first.
            Signature.objects.filter(
                employee=signature.employee, status=Signature.Status.APPROVED
            ).exclude(pk=signature.pk).update(status=Signature.Status.SUPERSEDED)

            signature.status = Signature.Status.APPROVED
            signature.decided_by = request.user
            signature.decided_at = timezone.now()
            signature.note = request.data.get("note", "")
            signature.updated_by = request.user
            signature.save()

        notify(
            signature.employee.user,
            "signature_approved",
            "Your signature has been approved and will be applied to memoranda you sign.",
            email_subject="Signature approved",
        )
        return Response(SignatureSerializer(signature, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, *args, **kwargs):
        if not can(request.user, Perm.PEOPLE_MANAGE):
            return Response(status=status.HTTP_403_FORBIDDEN)
        signature = self.get_object()
        signature.status = Signature.Status.REJECTED
        signature.decided_by = request.user
        signature.decided_at = timezone.now()
        # Said plainly, because otherwise the employee has to guess what was
        # wrong with it and uploads the same image again.
        signature.note = request.data.get("note", "")
        signature.updated_by = request.user
        signature.save()

        notify(
            signature.employee.user,
            "signature_rejected",
            f"Your signature was not approved. {signature.note}".strip(),
            email_subject="Signature not approved",
        )
        return Response(SignatureSerializer(signature, context={"request": request}).data)

    @action(detail=False, methods=["get"], url_path="mine")
    def mine(self, request, *args, **kwargs):
        """This person's signatures, newest first — the profile view."""
        me = getattr(request.user, "employee", None)
        rows = self.get_queryset().filter(employee=me) if me else Signature.objects.none()
        return Response(
            SignatureSerializer(rows, many=True, context={"request": request}).data
        )
