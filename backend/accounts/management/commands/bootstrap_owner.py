"""Create the owner account — the one step that cannot be done from inside.

**Why a command rather than a sign-up form.** This is one company's system,
installed for them and deployed on their own branch. There is no self-service
funnel to open, and a public "create your account" page on a private HRMS is a
door with nothing behind it but risk. Somebody with shell access on the box
creates the first account; everybody else is invited from inside the product.

Idempotent: run it twice and the second run reports the existing owner rather
than creating a second one. Owner is not an appointable role (see
`accounts.policy.set_role`), so this is the only way one comes into existence.

    python manage.py bootstrap_owner --email owner@company.com.np \
        --first-name Sita --last-name Sharma
"""

import getpass

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import User
from accounts.utils import generate_temp_password


class Command(BaseCommand):
    help = "Create the owner account. Run once, at install."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--first-name", default="")
        parser.add_argument("--last-name", default="")
        parser.add_argument(
            "--password",
            default=None,
            help="Omit to be prompted, or to have one generated in a non-interactive shell.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        if not email:
            raise CommandError("An email address is required — it is the login.")

        existing = User.objects.filter(role=User.Role.OWNER).first()
        if existing is not None:
            self.stdout.write(
                self.style.WARNING(
                    f"This system already has an owner: {existing.email or existing.get_username()}. "
                    "Nothing was created."
                )
            )
            return

        if User.objects.filter(email__iexact=email).exists():
            raise CommandError(f"{email} already has an account. Promote it instead, or use another address.")

        password = options["password"]
        generated = False
        if not password:
            try:
                password = getpass.getpass("Password for the owner (blank to generate): ")
            except (EOFError, KeyboardInterrupt):
                password = ""
            if not password:
                password = generate_temp_password()
                generated = True

        user = User(
            username=email.split("@")[0],
            email=email,
            first_name=options["first_name"],
            last_name=options["last_name"],
            role=User.Role.OWNER,
            # The owner is the technical root of this deployment, so they also
            # get the Django admin. `role=owner` is what the product reads;
            # `is_superuser` is what `/admin/` reads, and the two have to agree
            # or the person who installed the system cannot reach the database
            # tools that come with it.
            is_staff=True,
            is_superuser=True,
            # Only when we chose it. A password the person typed is already
            # theirs, and marching them through a change screen for it is noise.
            must_change_password=generated,
        )
        user.set_password(password)
        user.save()

        self.stdout.write(self.style.SUCCESS(f"Owner created: {email}"))
        if generated:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING("  Generated password (shown once):"))
            self.stdout.write(f"    {password}")
            self.stdout.write("")
            self.stdout.write("  They will be asked to change it at first sign-in.")
