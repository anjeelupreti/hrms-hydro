from django.urls import path
from rest_framework.routers import DefaultRouter

from employees.change_request_api import EmployeeChangeRequestViewSet
from employees.viewsets import (
    AwardViewSet,
    CorporatePostViewSet,
    CorporateRoleViewSet,
    DepartmentViewSet,
    DependantViewSet,
    DesignationViewSet,
    EducationRecordViewSet,
    EmergencyContactViewSet,
    EmployeeViewSet,
    LifecycleEventViewSet,
    DisciplinaryActionViewSet,
    NomineeViewSet,
    OffboardingSummaryView,
    SuspensionViewSet,
)

app_name = "employees"

router = DefaultRouter()
router.register("departments", DepartmentViewSet, basename="department")
router.register("designations", DesignationViewSet, basename="designation")
# Post and role, which are different questions — see `Employee.corporate_post`.
router.register("corporate-posts", CorporatePostViewSet, basename="corporate-post")
router.register("corporate-roles", CorporateRoleViewSet, basename="corporate-role")
router.register("employees", EmployeeViewSet, basename="employee")
router.register("lifecycle-events", LifecycleEventViewSet, basename="lifecycle-event")
# What an employee has asked HR to change about their own record - the
# approval step that keeps a bank account from moving silently.
router.register("change-requests", EmployeeChangeRequestViewSet, basename="change-request")
# The lists that hang off one person. Scoped by `?employee=`, defaulting to
# the caller, so an employee reaches their own without knowing their id.
router.register("emergency-contacts", EmergencyContactViewSet, basename="emergency-contact")
router.register("dependants", DependantViewSet, basename="dependant")
router.register("nominees", NomineeViewSet, basename="nominee")
router.register("education", EducationRecordViewSet, basename="education-record")
# What the company records *about* somebody, which they may read and only HR
# may write — see `_EmployeeHRRecordViewSet`.
router.register("awards", AwardViewSet, basename="award")
router.register("disciplinary-actions", DisciplinaryActionViewSet, basename="disciplinary-action")
router.register("suspensions", SuspensionViewSet, basename="suspension")

urlpatterns = [
    # What is still open between a leaver and the company — assets, loans,
    # unpaid expenses, untaken leave.
    path(
        "employees/<int:pk>/offboarding-summary/",
        OffboardingSummaryView.as_view(),
        name="offboarding-summary",
    ),
] + router.urls
