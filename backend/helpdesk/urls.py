from rest_framework.routers import DefaultRouter

from helpdesk.viewsets import TicketViewSet

app_name = "helpdesk"

router = DefaultRouter()
router.register("tickets", TicketViewSet, basename="ticket")

urlpatterns = router.urls
