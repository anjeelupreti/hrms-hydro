from rest_framework.routers import DefaultRouter

from crm.viewsets import (
    ActivityViewSet,
    ClientTicketViewSet,
    ClientViewSet,
    ContactViewSet,
    DealViewSet,
    InvoiceViewSet,
)

app_name = "crm"

router = DefaultRouter()
router.register("clients", ClientViewSet, basename="client")
router.register("tickets", ClientTicketViewSet, basename="client-ticket")
router.register("contacts", ContactViewSet, basename="contact")
router.register("deals", DealViewSet, basename="deal")
router.register("invoices", InvoiceViewSet, basename="invoice")
router.register("activities", ActivityViewSet, basename="activity")

urlpatterns = router.urls
