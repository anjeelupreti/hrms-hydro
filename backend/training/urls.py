from rest_framework.routers import DefaultRouter

from training.viewsets import EnrollmentViewSet, TrainingProgramViewSet, TrainingSessionViewSet

app_name = "training"

router = DefaultRouter()
router.register("programs", TrainingProgramViewSet, basename="program")
router.register("sessions", TrainingSessionViewSet, basename="session")
router.register("enrollments", EnrollmentViewSet, basename="enrollment")

urlpatterns = router.urls
