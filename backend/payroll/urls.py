from django.urls import path
from rest_framework.routers import DefaultRouter

from payroll.statutory_api import (
    ContributionReportView,
    ContributionSummaryView,
    EmployeeSchemeEnrolmentViewSet,
    StatutoryRateViewSet,
    TaxPlannerView,
)
from payroll.viewsets import (
    LoanViewSet,
    PaymentBatchViewSet,
    PayrollReportView,
    PayrollRunViewSet,
    PayslipViewSet,
    SalaryComponentViewSet,
    SalaryStructureViewSet,
    SalaryTemplateViewSet,
    TaxSlabViewSet,
)

app_name = "payroll"

router = DefaultRouter()
router.register("components", SalaryComponentViewSet, basename="salary-component")
router.register("tax-slabs", TaxSlabViewSet, basename="tax-slab")
# The legislated figures. Had no route at all until 25 Aug, which made "every
# statutory figure is configuration" true of the design and not of the product.
router.register("statutory-rates", StatutoryRateViewSet, basename="statutory-rate")
# Who sits outside the company scheme, or pays a different rate, or has chosen
# a CIT amount. A row exists only where somebody differs.
router.register("scheme-enrolments", EmployeeSchemeEnrolmentViewSet, basename="scheme-enrolment")
# Totals per scheme, not the rows — nobody wants to sum them client-side (§2.6).
router.register("contributions", ContributionSummaryView, basename="contribution-summary")
# Everybody's, for filing and reconciling against the fund deposit.
router.register("contribution-report", ContributionReportView, basename="contribution-report")
# The employee's own projection. Deliberately takes no `?employee=` — see the view.
router.register("tax-planner", TaxPlannerView, basename="tax-planner")
router.register("structures", SalaryStructureViewSet, basename="salary-structure")
# Templates sit beside structures rather than under them: one is a record of
# what was paid, the other a starting point that has paid nobody.
router.register("salary-templates", SalaryTemplateViewSet, basename="salary-template")
router.register("runs", PayrollRunViewSet, basename="payroll-run")
router.register("payment-batches", PaymentBatchViewSet, basename="payment-batch")
router.register("payslips", PayslipViewSet, basename="payslip")
router.register("loans", LoanViewSet, basename="loan")

urlpatterns = [
    path("reports/", PayrollReportView.as_view(), name="payroll-reports"),
] + router.urls
