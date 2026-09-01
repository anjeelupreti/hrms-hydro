"""Register an attendance terminal and issue its push token.

Until the console grows a device screen (see docs/development-plan.md P4),
this is how a terminal gets credentials. Run it inside the company's schema:

    python manage.py register_device --schema acme \\
        --name "Main gate" --serial ZK-8821 --type zkteco

The token is printed once and never recoverable — only its hash is stored.
"""

from django.core.management.base import BaseCommand, CommandError

from attendance.models import Device


class Command(BaseCommand):
    help = "Register an attendance device and print its push token (shown once)."

    def add_arguments(self, parser):
        parser.add_argument("--name", required=True, help="Human label, e.g. 'Main gate'.")
        parser.add_argument("--serial", required=True, help="Device serial number (unique).")
        parser.add_argument(
            "--type",
            dest="device_type",
            default=Device.DeviceType.GENERIC,
            choices=[c[0] for c in Device.DeviceType.choices],
        )
        parser.add_argument("--location", default="", help="Optional placement note.")
        parser.add_argument("--timezone", dest="timezone_name", default="UTC")
        parser.add_argument(
            "--rotate",
            action="store_true",
            help="Device already exists — issue a new token and invalidate the old one.",
        )

    def handle(self, *args, **options):
        existing = Device.objects.filter(serial=options["serial"]).first()

        if existing and not options["rotate"]:
            raise CommandError(
                f"Device {options['serial']} already exists. "
                "Pass --rotate to issue a replacement token."
            )

        if existing:
            token = existing.rotate_secret()
            device = existing
            action = "Rotated token for"
        else:
            device = Device(
                name=options["name"],
                serial=options["serial"],
                device_type=options["device_type"],
                location=options["location"],
                timezone_name=options["timezone_name"],
            )
            token = Device.generate_secret()
            device.set_secret(token)
            device.save()
            action = "Registered"

        self.stdout.write(self.style.SUCCESS(f"{action} {device.name} ({device.serial})"))
        self.stdout.write("")
        self.stdout.write(self.style.WARNING("  Push token (shown once — store it now):"))
        self.stdout.write(f"    {token}")
        self.stdout.write("")
        self.stdout.write("  Configure the terminal to POST to /api/v1/attendance/device-sync/")
        self.stdout.write("  with header:  Authorization: Bearer <token>")
        if options["rotate"]:
            self.stdout.write(self.style.WARNING("  The previous token is now rejected."))
