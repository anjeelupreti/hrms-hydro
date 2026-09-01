"""Give the company one reminder rule per available kind.

**Why a command and not a migration.** The set of kinds lives in a registry, not
in the schema, so it grows without a migration — and a data migration that
seeded them would only ever run once, leaving any kind added afterwards
missing. Run this after adding one.

Idempotent: `seed_default_rules` uses `get_or_create` keyed on kind, so a rule
that already exists keeps the wording and the lead times somebody chose. It
only ever adds what is missing.
"""

from django.core.management.base import BaseCommand

from notifications.reminders import seed_default_rules


class Command(BaseCommand):
    help = "Create any missing reminder rules."

    def handle(self, *args, **options):
        created = seed_default_rules()
        if created:
            self.stdout.write(self.style.SUCCESS(f"Added: {', '.join(created)}"))
        else:
            self.stdout.write("Already complete.")
