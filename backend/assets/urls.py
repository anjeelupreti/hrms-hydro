from rest_framework.routers import DefaultRouter

from assets.viewsets import AssetPhotoViewSet, AssetViewSet

app_name = "assets"

router = DefaultRouter()
router.register("assets", AssetViewSet, basename="asset")
router.register("photos", AssetPhotoViewSet, basename="asset-photo")

urlpatterns = router.urls
