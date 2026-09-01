class AuditViewSetMixin:
    """Stamps created_by/updated_by from the request user automatically —
    callers never send these fields, and can't spoof who made a change."""

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)
