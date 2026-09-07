"""Seed meetings in every state, from both sides of the table.

Separate from `seed_hydro` so it can be run against a database that already has
people in it — the usual reason to want this is "show me what the module can
do", and wiping the company to find out is not a reasonable price.
"""

from django.core.management.base import BaseCommand

from notifications.seeding import seed_meetings


class Command(BaseCommand):
    help = "Create meetings covering scheduled, ended and cancelled, organised and invited."

    def add_arguments(self, parser):
        parser.add_argument(
            "--for",
            dest="username",
            default="owner",
            help="Whose desk to seed them around. Defaults to owner.",
        )

    def handle(self, *args, **options):
        self.stdout.write("Seeding meetings…")
        made = seed_meetings(for_username=options["username"], stdout=self.stdout)
        self.stdout.write(self.style.SUCCESS(f"Done — {made} new."))
