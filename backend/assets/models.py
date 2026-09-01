from django.db import models

from core.models import AuditModel


def asset_photo_upload_path(instance, filename):
    # Schema-namespaced, matching every other upload here: one disk serves
    # all companies, and `core.media` gates a request by comparing the second
    # path segment to the caller's schema. A path shaped any other way is
    # unreachable rather than merely untidy.
    return f"assets/photos/{instance.asset_id or 'new'}/{filename}"


class Asset(AuditModel):
    """A company asset (laptop, phone, furniture…) that can be assigned to an
    employee and returned on exit. Reuses the lifecycle idea: assignment
    history is kept, and `assigned_to`/`status` are the live snapshot."""

    class Category(models.TextChoices):
        LAPTOP = "laptop", "Laptop"
        DESKTOP = "desktop", "Desktop"
        MONITOR = "monitor", "Monitor"
        PHONE = "phone", "Phone"
        FURNITURE = "furniture", "Furniture"
        VEHICLE = "vehicle", "Vehicle"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        AVAILABLE = "available", "Available"
        ASSIGNED = "assigned", "Assigned"
        MAINTENANCE = "maintenance", "In maintenance"
        RETIRED = "retired", "Retired"

    name = models.CharField(max_length=200)
    asset_tag = models.CharField(max_length=60, unique=True)
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.OTHER)
    serial_number = models.CharField(max_length=120, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.AVAILABLE)
    purchase_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    # Live snapshot of the current holder (assignment history is separate).
    assigned_to = models.ForeignKey(
        "employees.Employee", null=True, blank=True, on_delete=models.SET_NULL, related_name="assets"
    )

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.asset_tag})"


class AssetAssignment(AuditModel):
    """One assignment of an asset to an employee. An open row (returned_at
    null) is the current holder; closing it (setting returned_at) frees the
    asset. The full history stays for audit / offboarding."""

    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="assignments")
    employee = models.ForeignKey(
        "employees.Employee", on_delete=models.CASCADE, related_name="asset_assignments"
    )
    assigned_at = models.DateField()
    returned_at = models.DateField(null=True, blank=True)
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-assigned_at", "-id"]

    def __str__(self):
        return f"{self.asset_id} -> {self.employee_id}"


class AssetPhoto(AuditModel):
    """A picture of an asset, at a moment.

    **Why an asset register needs photographs at all.** Everything else here is
    a claim: the tag says which laptop, the status says who has it. What none of
    it can settle is the argument that actually happens — *it came back with a
    cracked lid* — because the register records that the machine went out and
    came back, not what it looked like on either day. A photo taken at handover
    is the only entry in this module that a person cannot dispute later.

    Several per asset, not one. A single `photo` field would force a choice
    between the machine, the serial plate and the damage, and whichever was
    chosen the next person would overwrite.

    `CASCADE`: unlike the assignment history, a photo is not a record of
    anything once its asset is gone — there is no orphan worth keeping.
    """

    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="photos")
    image = models.ImageField(upload_to=asset_photo_upload_path)
    caption = models.CharField(
        max_length=200,
        blank=True,
        help_text="What this shows — 'serial plate', 'scratch on lid at handover'.",
    )

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"photo of {self.asset.asset_tag}"
