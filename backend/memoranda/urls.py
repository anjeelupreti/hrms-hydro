from rest_framework.routers import DefaultRouter

from memoranda.viewsets import MemorandumActionViewSet, MemorandumViewSet

app_name = "memoranda"

router = DefaultRouter()
router.register("memoranda", MemorandumViewSet, basename="memorandum")
# The vocabulary a handler picks from — configured by the owner or an HR admin,
# read by everybody. See `MemorandumActionViewSet`.
router.register("actions", MemorandumActionViewSet, basename="memorandum-action")

urlpatterns = router.urls
