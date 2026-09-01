from rest_framework.routers import DefaultRouter

from documents.viewsets import DocumentSignatureViewSet, RepositoryDocumentViewSet

app_name = "documents"

router = DefaultRouter()
router.register("repository", RepositoryDocumentViewSet, basename="repository")
router.register("signatures", DocumentSignatureViewSet, basename="signature")

urlpatterns = router.urls
