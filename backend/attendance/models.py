import hashlib
import hmac
import secrets
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import AuditModel
from employees.models import Employee


def hash_device_secret(raw: str) -> str:
    """SHA-256 of a device token.

    A plain digest is the right primitive here, not a password KDF: the token
    is high-entropy and machine-generated, so there is nothing to brute-force,
    and a device pushing every 30 seconds must not cost us a PBKDF2 round each
    time — that would turn our own auth into a denial-of-service lever.
    """
    return hashlib.sha256(raw.encode()).hexdigest()


class Device(AuditModel):
    """A registered biometric/attendance terminal allowed to push events.

    Exists because the ingest endpoint is necessarily unauthenticated in the
    session sense — a wall-mounted terminal has no user. Authorisation is
    therefore per-device: a token issued here, hashed at rest, and matched on
    every push. Without this table the endpoint has no way to tell a customer's
    terminal from anyone else on the internet.
    """

    class DeviceType(models.TextChoices):
        ZKTECO = "zkteco", "ZKTeco"
        HIKVISION = "hikvision", "Hikvision"
        GENERIC = "generic", "Generic / custom push"

    name = models.CharField(max_length=100)
    serial = models.CharField(max_length=100, unique=True)
    device_type = models.CharField(max_length=20, choices=DeviceType.choices, default=DeviceType.GENERIC)

    # Connection details are informational for now — the device pushes to us.
    # They matter once pull-mode adapters land (see docs/development-plan.md P4).
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    port = models.PositiveIntegerField(null=True, blank=True)
    timezone_name = models.CharField(
        max_length=64,
        default="UTC",
        help_text="Olson name the device stamps its punches in, e.g. Asia/Kathmandu.",
    )
    location = models.CharField(max_length=150, blank=True)

    # Never stores the token itself — issuing returns it once and it is gone.
    secret_hash = models.CharField(max_length=64, unique=True, editable=False)

    is_active = models.BooleanField(default=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["secret_hash"])]

    def __str__(self):
        return f"{self.name} ({self.serial})"

    @staticmethod
    def generate_secret() -> str:
        """A fresh token. Show it to the operator once — we only keep the hash."""
        return secrets.token_urlsafe(32)

    def set_secret(self, raw: str) -> None:
        self.secret_hash = hash_device_secret(raw)

    def rotate_secret(self) -> str:
        """Issue a new token, invalidating the old one. Returns the plaintext."""
        raw = self.generate_secret()
        self.set_secret(raw)
        self.save(update_fields=["secret_hash", "updated_at"])
        return raw

    def check_secret(self, raw: str) -> bool:
        return hmac.compare_digest(self.secret_hash, hash_device_secret(raw))

    def mark_seen(self) -> None:
        self.last_seen_at = timezone.now()
        self.save(update_fields=["last_seen_at"])


class Shift(AuditModel):
    name = models.CharField(max_length=100, unique=True)
    start_time = models.TimeField()
    end_time = models.TimeField()
    grace_period_minutes = models.PositiveIntegerField(default=15)

    #: Unpaid break inside this shift, where it differs from the company's.
    #:
    #: Null means "use the company setting" rather than "no break" — the same
    #: reason the night allowance sits on the shift: a factory shift and an
    #: office one genuinely differ, and a single company-wide number cannot be
    #: right for both. A shift that really has no break sets zero, which is a
    #: different statement from leaving it unset.
    unpaid_break_minutes = models.PositiveIntegerField(null=True, blank=True)

    # A night shift is paid differently, so it has to be a property of the
    # shift rather than something inferred from the clock. Inferring it (say,
    # "starts after 18:00") breaks the moment a company runs a 16:00–00:00 shift
    # they do not consider a night shift, and payroll would silently pay an
    # allowance nobody agreed to.
    is_night_shift = models.BooleanField(
        default=False,
        help_text="Attracts the night allowance below for each shift actually worked.",
    )
    # Flat amount per night worked, not per hour: this is how night work is
    # normally compensated here, and it is per-shift rather than company-wide
    # so a factory night shift and an office one can differ.
    night_allowance = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0"),
        help_text="Paid once per night shift worked. Only applies when is_night_shift.",
    )

    class Meta:
        ordering = ["start_time"]

    def __str__(self):
        return f"{self.name} ({self.start_time}–{self.end_time})"


class OvertimeRecord(AuditModel):
    """Approved overtime, as its own record rather than a derived number.

    **Why not compute it from check-out time.** Staying late is not the same
    thing as authorised overtime, legally or financially. Deriving payable
    hours from the clock means every late departure becomes a cost the company
    never agreed to, and it removes the approval step that makes overtime
    auditable. So hours are recorded and approved explicitly, and **only
    approved rows reach payroll**.

    Rate lives on the company (`CompanyProfile.overtime_multiplier`) rather than
    here, so a change to the rate does not require editing historical rows —
    but `multiplier` is snapshotted on approval for exactly the opposite
    reason: what was approved must stay what gets paid, even if the company
    changes the rate next month.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending approval"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="overtime_records"
    )
    date = models.DateField()
    hours = models.DecimalField(max_digits=5, decimal_places=2)
    reason = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)

    approved_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    # Snapshotted from the company setting at approval — see the class docstring.
    multiplier = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Rate multiplier fixed at approval, so a later rate change cannot alter approved overtime.",
    )

    class Meta:
        ordering = ["-date"]
        constraints = [
            # One row per employee per day: two overlapping claims for the same
            # date is the shape a duplicate payment takes.
            models.UniqueConstraint(
                fields=["employee", "date"], name="unique_overtime_employee_date"
            )
        ]

    def __str__(self):
        return f"{self.employee.employee_code} — {self.date}: {self.hours}h ({self.status})"


class ShiftAssignment(AuditModel):
    """Date-ranged shift history for an employee. end_date null means
    still in effect. Enables shift rotation and historical reporting
    (e.g. 'what shift was this employee on last month')."""

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="shift_assignments")
    shift = models.ForeignKey(Shift, on_delete=models.CASCADE, related_name="assignments")
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["-start_date"]

    def __str__(self):
        return f"{self.employee.employee_code}: {self.shift.name} from {self.start_date}"


class AttendanceLog(AuditModel):
    class Source(models.TextChoices):
        WEB = "web", "Web check-in"
        MANUAL = "manual", "Manual (HR entry)"
        BIOMETRIC = "biometric", "Biometric device"
        SYSTEM = "system", "System (absence sweep)"

    class Status(models.TextChoices):
        PRESENT = "present", "Present"
        LATE = "late", "Late"
        ABSENT = "absent", "Absent"
        HALF_DAY = "half_day", "Half Day"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="attendance_logs")
    date = models.DateField()
    check_in_time = models.DateTimeField(null=True, blank=True)
    check_out_time = models.DateTimeField(null=True, blank=True)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.WEB)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PRESENT)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-date"]
        constraints = [
            models.UniqueConstraint(fields=["employee", "date"], name="unique_employee_date")
        ]

    def __str__(self):
        return f"{self.employee.employee_code} — {self.date} ({self.status})"


class AttendanceSession(AuditModel):
    """One in-and-out. A day is made of several.

    **Why the day record was not enough.** `AttendanceLog` carries a single
    `check_in_time` and `check_out_time`, so the product allowed exactly one
    punch each way per day. Real days are not shaped like that: people go out
    for lunch, take a break, step out to a client and come back. Under the old
    model the second check-in was refused as "already checked in today", so
    either the break went unrecorded or somebody's afternoon did.

    **The day record stays.** `AttendanceLog` is still the one row per person
    per day that carries the *status* — present, late, absent, half day — and
    everything downstream reads it, payroll included. This model sits beneath
    it and holds the punches. Splitting it that way means the status question
    ("was she here?") and the timing question ("when exactly?") stop competing
    for the same two columns.

    An open session — `check_out_time` is null — is somebody currently at work.
    There can be at most one of those per day, which is what makes the button
    on screen able to say Out rather than In.
    """

    log = models.ForeignKey(
        "attendance.AttendanceLog", on_delete=models.CASCADE, related_name="sessions"
    )
    check_in_time = models.DateTimeField()
    check_out_time = models.DateTimeField(null=True, blank=True)
    source = models.CharField(
        max_length=20, choices=AttendanceLog.Source.choices, default=AttendanceLog.Source.WEB
    )
    note = models.CharField(
        max_length=140,
        blank=True,
        help_text="Optional — what this stretch was. 'Client visit', 'lunch'.",
    )

    #: The last moment this person's browser said they were still there.
    #:
    #: **Why a heartbeat and not "closing the tab clocks you out".** Tying the
    #: clock-out to the tab closing is the right instinct — it ends the session
    #: when somebody actually stops, which is what makes overtime come out
    #: right, where a fixed office-end time would truncate it. But the browser
    #: cannot tell *closing* from *refreshing*: both fire `pagehide`, so F5
    #: would clock you out.
    #:
    #: Recording presence instead has the same effect and none of the problem.
    #: Close the tab and the beats stop, so the session ends where you left it.
    #: Refresh and the next beat arrives a second later, so nothing happens. A
    #: crash, a flat battery and a force-quit all behave like closing, which is
    #: the honest reading of each.
    last_seen = models.DateTimeField(null=True, blank=True)

    #: Closed by the system because the day ended with it still open, not by
    #: somebody pressing the button.
    #:
    #: **Kept as a flag rather than left to be inferred** from the tidy
    #: end-of-day timestamp: the difference between "worked until six" and
    #: "forgot to clock out" is the whole question when somebody disputes their
    #: hours, and a guessed time that looks like a real one is worse than no
    #: time at all. The screen marks these, and they are what a correction
    #: request is raised against.
    auto_closed = models.BooleanField(default=False)

    class Meta:
        ordering = ["check_in_time"]

    def __str__(self):
        return f"{self.log.employee.employee_code} {self.check_in_time:%H:%M}–{self.check_out_time:%H:%M}" if self.check_out_time else f"{self.log.employee.employee_code} {self.check_in_time:%H:%M}– (open)"

    @property
    def is_open(self):
        return self.check_out_time is None

    @property
    def seconds_worked(self):
        """Closed sessions only.

        An open session deliberately returns 0 rather than counting up to
        `now()`: a stored total that changes every time you read it cannot be
        summed, compared or tested. The screen shows the running clock; the
        model reports what is finished.
        """
        if self.check_out_time is None:
            return 0
        return int((self.check_out_time - self.check_in_time).total_seconds())


class AttendanceEditLog(models.Model):
    """Append-only correction history for AttendanceLog — same pattern as
    employees.EmployeeLog. Self check-in/out doesn't need an entry here
    (it's the record's own creation, already covered by created_by); this
    is specifically for HR corrections after the fact."""

    class Field(models.TextChoices):
        CHECK_IN_TIME = "check_in_time", "Check-in time"
        CHECK_OUT_TIME = "check_out_time", "Check-out time"
        STATUS = "status", "Status"

    attendance_log = models.ForeignKey(AttendanceLog, on_delete=models.CASCADE, related_name="edit_logs")
    field = models.CharField(max_length=30, choices=Field.choices)
    from_value = models.CharField(max_length=255, blank=True)
    to_value = models.CharField(max_length=255, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.attendance_log_id}: {self.field} {self.from_value!r} -> {self.to_value!r}"


class AttendanceDeviceEvent(models.Model):
    """Raw staging table for future biometric device sync. Devices (or a
    simulated event, for now) write here; a separate processing step
    resolves the external employee id and creates/updates AttendanceLog
    rows. Kept decoupled from AttendanceLog so a bad/unmatched device
    event never blocks or corrupts the canonical attendance record."""

    class EventType(models.TextChoices):
        CHECK_IN = "check_in", "Check-in"
        CHECK_OUT = "check_out", "Check-out"

    # The registered terminal that pushed this event. Nullable so historic rows
    # (staged before the registry existed) survive the migration.
    device = models.ForeignKey(
        Device,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="events",
    )
    # The raw identifier the terminal reported, kept alongside the FK for
    # provenance even if the Device row is later renamed or removed. Named
    # `reported_device_id` because plain `device_id` is the FK's own column.
    reported_device_id = models.CharField(max_length=100)
    external_employee_id = models.CharField(max_length=100)
    event_type = models.CharField(max_length=20, choices=EventType.choices)
    raw_timestamp = models.DateTimeField()
    raw_payload = models.JSONField(default=dict, blank=True)
    processed = models.BooleanField(default=False)
    processed_at = models.DateTimeField(null=True, blank=True)
    error = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-raw_timestamp"]

    def __str__(self):
        return f"{self.reported_device_id}/{self.external_employee_id}: {self.event_type} @ {self.raw_timestamp}"


class RegularisationRequest(AuditModel):
    """An employee disputing their own attendance record.

    **Why a workflow rather than an edit.** `AttendanceEditLog` already covers
    HR correcting a record after the fact, and that is the only route that
    existed — so an employee whose badge failed had to ask somebody to change
    their attendance for them, with the conversation happening outside the
    system and only the result recorded. The dispute, the reason and the
    decision are the parts worth keeping.

    The request **never touches the attendance log until it is approved**. A
    pending request is a claim, not a correction, and letting it write
    immediately would make attendance self-service editable — which is the same
    thing as not recording attendance.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        CANCELLED = "cancelled", "Cancelled"

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="regularisation_requests"
    )
    #: The day being disputed. Not a FK to `AttendanceLog`, because the most
    #: common case is a day with **no log at all** — a missed punch — and a
    #: request that can only point at an existing record cannot report one.
    date = models.DateField()

    requested_check_in = models.DateTimeField(null=True, blank=True)
    requested_check_out = models.DateTimeField(null=True, blank=True)
    requested_status = models.CharField(
        max_length=20, choices=AttendanceLog.Status.choices, blank=True
    )
    #: Required in the API. Asking to change an attendance record without
    #: saying why leaves the approver guessing, and the reason is what the
    #: decision is actually made on.
    reason = models.TextField()

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    reviewed_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True)

    class Meta:
        ordering = ["-date", "-created_at"]
        constraints = [
            # One open request per employee per day. A second is either a
            # duplicate or a revision of the first, and both are better handled
            # by editing the open one than by queueing a rival claim.
            models.UniqueConstraint(
                fields=["employee", "date"],
                condition=models.Q(status="pending"),
                name="one_open_regularisation_per_day",
            )
        ]

    def __str__(self):
        return f"{self.employee.employee_code} — {self.date} ({self.status})"
