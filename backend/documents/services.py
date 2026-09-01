from django.contrib.contenttypes.models import ContentType
from django.core.files.base import ContentFile

from documents.models import Document


def save_generated_document(content_object, filename, content_bytes, kind, actor=None):
    """Persists a server-generated file (e.g. a rendered payslip PDF)
    against any model instance. The single seam for where generated
    files land — swapping local disk for S3-compatible storage later is
    a STORAGES settings change, not a call-site change."""
    document = Document(
        kind=kind,
        original_filename=filename,
        content_type=ContentType.objects.get_for_model(content_object),
        object_id=content_object.pk,
        created_by=actor,
        updated_by=actor,
    )
    document.file.save(filename, ContentFile(content_bytes), save=True)
    return document


def latest_document_for(content_object, kind=Document.Kind.GENERIC):
    content_type = ContentType.objects.get_for_model(content_object)
    return (
        Document.objects.filter(
            content_type=content_type, object_id=content_object.pk, kind=kind
        )
        .order_by("-created_at")
        .first()
    )
