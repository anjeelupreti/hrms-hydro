from django.db.models import Count, Q
from django_filters import rest_framework as django_filters
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from accounts.permissions import IsHRAdminOrReadOnly
from accounts.policy import Perm
from companies.models import Company
from companies.serializers import CompanyOptionSerializer, CompanySerializer
from core.viewsets import AuditViewSetMixin


class CompanyViewSet(AuditViewSetMixin, ModelViewSet):
    """The group's operating entities.

    Readable by anybody signed in — an employee's own profile names their
    company, so hiding the list would only mean the name renders as an id.
    Creating one is an HR-admin act; an officer may keep the details current.
    """

    serializer_class = CompanySerializer
    permission_classes = [IsAuthenticated, IsHRAdminOrReadOnly]
    required_permission = Perm.SETTINGS_MANAGE
    filter_backends = [
        django_filters.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_fields = ["kind", "project_stage", "is_active", "parent"]
    search_fields = ["name", "code", "legal_name", "registration_number", "river"]
    ordering_fields = ["name", "code", "established_on", "installed_capacity_mw"]

    def get_queryset(self):
        return Company.objects.select_related("parent").annotate(
            employee_count=Count(
                "primary_employees",
                filter=Q(primary_employees__employment_status="active"),
                distinct=True,
            )
        )

    def destroy(self, request, *args, **kwargs):
        """Refused while anybody is employed here.

        A company is deactivated, not deleted: it still owns the employment
        history of everyone who worked for it, and a payslip naming an entity
        that no longer exists in the database is unreadable. `PROTECT` on
        `Employee.primary_company` would raise a 500 for the same case, so the
        refusal is stated here with a reason somebody can act on.
        """
        company = self.get_object()
        employed = company.primary_employees.count()
        if employed:
            return Response(
                {
                    "detail": (
                        f"{company.name} still has {employed} employee(s) on its payroll. "
                        "Move them to another company first, or deactivate this one instead."
                    ),
                    "code": "company_in_use",
                },
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=["get"])
    def options(self, request, *args, **kwargs):
        """Active companies, in the shape a picker needs."""
        companies = Company.objects.filter(is_active=True).order_by("name")
        return Response(CompanyOptionSerializer(companies, many=True).data)
