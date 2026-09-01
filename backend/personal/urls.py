from rest_framework.routers import DefaultRouter

from personal.viewsets import TodoViewSet

app_name = "personal"

router = DefaultRouter()
router.register("todos", TodoViewSet, basename="todo")

urlpatterns = router.urls
