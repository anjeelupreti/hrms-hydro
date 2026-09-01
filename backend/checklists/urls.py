from rest_framework.routers import DefaultRouter

from checklists.viewsets import (
    ChecklistTaskViewSet,
    ChecklistTemplateViewSet,
    ChecklistViewSet,
)

app_name = "checklists"

router = DefaultRouter()
router.register("templates", ChecklistTemplateViewSet, basename="checklist-template")
router.register("tasks", ChecklistTaskViewSet, basename="checklist-task")
router.register("", ChecklistViewSet, basename="checklist")

urlpatterns = router.urls
