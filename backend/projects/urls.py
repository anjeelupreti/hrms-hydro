from rest_framework.routers import DefaultRouter

from projects.viewsets import (
    MilestoneViewSet,
    ProjectTaskViewSet,
    ProjectViewSet,
    SprintViewSet,
    TaskAttachmentViewSet,
    TaskCommentViewSet,
)

app_name = "projects"

router = DefaultRouter()
router.register("projects", ProjectViewSet, basename="project")
router.register("sprints", SprintViewSet, basename="sprint")
router.register("milestones", MilestoneViewSet, basename="milestone")
router.register("tasks", ProjectTaskViewSet, basename="project-task")
router.register("comments", TaskCommentViewSet, basename="task-comment")
router.register("attachments", TaskAttachmentViewSet, basename="task-attachment")

urlpatterns = router.urls
