from django.conf import settings
from django.db import models


class AuditModel(models.Model):
    """Abstract base giving every company-scoped model a who/when trail.

    created_by/updated_by are nullable because system-initiated changes
    (Celery tasks, migrations, seed data) have no request.user.
    """

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    class Meta:
        abstract = True

