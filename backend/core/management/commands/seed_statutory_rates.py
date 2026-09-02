"""Seed the statutory rate table for a fiscal year.

Separate from the demo seeds because this is not demo data — it is the country
pack a real company starts from, and it has to be runnable against a live
database each year when the Finance Act lands.
"""

from django.core.management.base import BaseCommand

from core.calendars import company_calendar
from payroll.statutory import seed_statutory_rates


class Command(BaseCommand):
    help = "Create missing statutory rates (SSF, PF, gratuity, ceilings…) for a fiscal year."

    def add_arguments(self, parser):
        parser.add_argument(
            "--fiscal-year",
            type=int,
            help="Opening year, e.g. 2082 for FY 2082/83. Defaults to the current one.",
        )

    def handle(self, *args, **options):
        from datetime import date

        fiscal_year = options.get("fiscal_year")
        if fiscal_year is None:
            fiscal_year = company_calendar().fiscal_year_of(date.today())

        created = seed_statutory_rates(fiscal_year)
        if created:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Seeded {len(created)} rate(s) for FY {fiscal_year} — {', '.join(created)}"
                )
            )
        else:
            self.stdout.write(f"FY {fiscal_year} already configured, nothing added.")

        self.stdout.write("")
        self.stdout.write(
            self.style.WARNING(
                "These are DEFAULTS, not law. Every row is marked unverified until "
                "somebody confirms it against the current Finance Act / SSF notice "
                "and records the source."
            )
        )
