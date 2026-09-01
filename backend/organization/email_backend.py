from django.core.mail.backends.smtp import EmailBackend as SMTPEmailBackend

from organization.models import CompanyEmailSettings


class CompanyAwareEmailBackend(SMTPEmailBackend):
    """Sends through the company's own SMTP account where one is configured.

    Reads the active `CompanyEmailSettings` row and connects with its
    host/port/credentials, so mail leaves from the company's real address
    rather than a generic one. Falls back to the `EMAIL_*` env defaults in
    `settings/base.py` when no override is active, or before the database has
    been migrated — a missing configuration must never stop mail going out.
    """

    def __init__(self, *args, **kwargs):
        source = self._active_settings()
        if source and source.host:
            kwargs.setdefault("host", source.host)
            kwargs.setdefault("port", source.port)
            kwargs.setdefault("username", source.username)
            kwargs.setdefault("password", source.get_password())
            kwargs.setdefault("use_tls", source.use_tls)
        super().__init__(*args, **kwargs)
        self._company_settings = source

    @staticmethod
    def _active_settings():
        try:
            return CompanyEmailSettings.objects.filter(is_active=True).first()
        except Exception:  # noqa: BLE001 — table not migrated yet
            return None

    def send_messages(self, email_messages):
        if self._company_settings and self._company_settings.from_email:
            for message in email_messages:
                message.from_email = self._company_settings.from_email
        return super().send_messages(email_messages)
