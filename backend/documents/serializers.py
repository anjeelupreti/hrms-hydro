from rest_framework import serializers

from documents.models import DocumentSignature, RepositoryDocument, SignatureRequest


def _employee_name(employee):
    if employee is None:
        return None
    return employee.user.get_full_name() or employee.user.get_username()


class RepositoryDocumentSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = RepositoryDocument
        fields = [
            "id",
            "title",
            "category",
            "visibility",
            "is_statutory",
            "employee",
            "employee_name",
            "description",
            "file",
            "original_filename",
            "uploaded_by_name",
            "created_at",
        ]
        # `is_statutory` is writable only by HR — the viewset forces it to
        # False for an employee's own upload, because that flag is what makes
        # HR access non-revocable and so must not be self-assignable.
        read_only_fields = ["id", "original_filename", "uploaded_by_name", "created_at"]
        extra_kwargs = {"file": {"write_only": True}}

    def get_employee_name(self, obj):
        if obj.employee is None:
            return None
        return obj.employee.user.get_full_name() or obj.employee.user.get_username()

    def get_uploaded_by_name(self, obj):
        if obj.created_by is None:
            return None
        return obj.created_by.get_full_name() or obj.created_by.get_username()

    #: Every visibility that describes one person's document rather than a
    #: company-wide one. Listed rather than "not COMPANY" so that adding a new
    #: level is a deliberate decision about which side it falls on.
    OWNED_VISIBILITIES = {
        RepositoryDocument.Visibility.PRIVATE,
        RepositoryDocument.Visibility.PERSONAL,
        RepositoryDocument.Visibility.HR_ONLY,
        RepositoryDocument.Visibility.MANAGER,
    }

    def validate(self, attrs):
        visibility = attrs.get("visibility", RepositoryDocument.Visibility.COMPANY)
        if visibility in self.OWNED_VISIBILITIES and not attrs.get("employee"):
            raise serializers.ValidationError(
                {"employee": "Required — this visibility describes one person's document."}
            )
        if visibility == RepositoryDocument.Visibility.COMPANY:
            # A company-wide document belongs to nobody in particular. Clearing
            # the owner keeps `employee` meaning "whose personal document this
            # is" rather than "who happened to upload it".
            attrs["employee"] = None
        return attrs


class DocumentSignatureSerializer(serializers.ModelSerializer):
    signer_name = serializers.SerializerMethodField()

    class Meta:
        model = DocumentSignature
        fields = [
            "id", "signer", "signer_name", "status", "signed_name",
            "signed_at", "decline_reason", "order",
        ]
        read_only_fields = fields

    def get_signer_name(self, obj):
        return _employee_name(obj.signer)


class SignatureRequestSerializer(serializers.ModelSerializer):
    signatures = DocumentSignatureSerializer(many=True, read_only=True)
    requested_by_name = serializers.SerializerMethodField()
    document_title = serializers.CharField(source="document.title", read_only=True)

    class Meta:
        model = SignatureRequest
        fields = [
            "id", "document", "document_title", "message", "status",
            "requested_by_name", "signatures", "created_at", "completed_at",
        ]
        read_only_fields = fields

    def get_requested_by_name(self, obj):
        if obj.created_by is None:
            return None
        return obj.created_by.get_full_name() or obj.created_by.get_username()


class MySignatureSerializer(serializers.ModelSerializer):
    """A signer's own to-sign queue item — flattened with the document +
    request context they need to act on it."""

    request_id = serializers.IntegerField(source="request.id", read_only=True)
    document_id = serializers.IntegerField(source="request.document.id", read_only=True)
    document_title = serializers.CharField(source="request.document.title", read_only=True)
    message = serializers.CharField(source="request.message", read_only=True)
    requested_by_name = serializers.SerializerMethodField()

    class Meta:
        model = DocumentSignature
        fields = [
            "id", "request_id", "document_id", "document_title", "message",
            "status", "signed_at", "requested_by_name", "created_at",
        ]
        read_only_fields = fields

    def get_requested_by_name(self, obj):
        by = obj.request.created_by
        return (by.get_full_name() or by.get_username()) if by else None
