from celery import shared_task

from mail.services import sync_inbox
from organization.models import CompanyEmailSettings


@shared_task
def sync_company_inbox():
    """Background IMAP sync of the company mailbox.

    A no-op unless an active email config with IMAP set exists — most
    deployments start without one, and this must not error on them.
    """
    settings_obj = CompanyEmailSettings.objects.filter(is_active=True).first()
    if not settings_obj or not settings_obj.imap_host:
        return "no imap configured"
    count = sync_inbox(settings_obj)
    return f"synced {count} new message(s)"
