from rest_framework import serializers

from assets.models import Asset, AssetAssignment, AssetEvent, AssetPhoto


def _emp_name(emp):
    if emp is None:
        return None
    return emp.user.get_full_name() or emp.user.get_username()


class AssetAssignmentSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()

    class Meta:
        model = AssetAssignment
        fields = ["id", "asset", "employee", "employee_name", "assigned_at", "returned_at", "note", "created_at"]
        read_only_fields = fields

    def get_employee_name(self, obj):
        return _emp_name(obj.employee)


class AssetPhotoSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()
    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = AssetPhoto
        fields = ["id", "asset", "image", "image_url", "caption", "uploaded_by_name", "created_at"]
        read_only_fields = ["id", "image_url", "uploaded_by_name", "created_at"]
        extra_kwargs = {"image": {"write_only": True}}

    def get_image_url(self, obj):
        """The path the browser should ask for — never `obj.image.url`.

        Media is served through a gate that checks the caller's schema, and the
        frontend proxies it under `/media/…` so the session travels with the
        request. Handing out a storage URL would produce an image that either
        404s or, worse, works without a check.
        """
        return f"/media/{obj.image.name}" if obj.image else None

    def get_uploaded_by_name(self, obj):
        user = obj.created_by
        if user is None:
            return None
        return user.get_full_name() or user.get_username()


class AssetSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.SerializerMethodField()
    photo_count = serializers.IntegerField(source="photos.count", read_only=True)
    #: The first photo, for the row and the card — so a list of assets can show
    #: what the things are without a request per asset.
    cover_url = serializers.SerializerMethodField()

    class Meta:
        model = Asset
        fields = [
            "id", "name", "asset_tag", "category", "serial_number", "status",
            "purchase_date", "notes", "assigned_to", "assigned_to_name", "created_at",
            "photo_count", "cover_url",
        ]
        read_only_fields = [
            "id", "status", "assigned_to", "assigned_to_name", "created_at",
            "photo_count", "cover_url",
        ]

    def get_assigned_to_name(self, obj):
        return _emp_name(obj.assigned_to)

    def get_cover_url(self, obj):
        first = obj.photos.first()
        return f"/media/{first.image.name}" if first and first.image else None


class AssetEventSerializer(serializers.ModelSerializer):
    """One line of an asset's history."""

    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    custodian_name = serializers.SerializerMethodField()
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = AssetEvent
        fields = [
            "id", "asset", "kind", "kind_display", "custodian", "custodian_name",
            "from_value", "to_value", "note", "occurred_on", "actor_name", "created_at",
        ]
        read_only_fields = ["created_at"]

    def get_custodian_name(self, obj):
        if obj.custodian is None:
            return None
        user = obj.custodian.user
        return user.get_full_name() or user.get_username()

    def get_actor_name(self, obj):
        if obj.actor is None:
            return "System"
        return obj.actor.get_full_name() or obj.actor.get_username()
