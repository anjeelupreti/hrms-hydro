from rest_framework import serializers

from attendance.models import (
    AttendanceDeviceEvent,
    AttendanceEditLog,
    AttendanceLog,
    AttendanceSession,
    Device,
    RegularisationRequest,
    Shift,
    ShiftAssignment,
)


class ShiftSerializer(serializers.ModelSerializer):
    class Meta:
        model = Shift
        fields = ["id", "name", "start_time", "end_time", "grace_period_minutes"]


class ShiftAssignmentSerializer(serializers.ModelSerializer):
    shift_name = serializers.CharField(source="shift.name", read_only=True)
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)

    class Meta:
        model = ShiftAssignment
        fields = [
            "id",
            "employee",
            "employee_code",
            "shift",
            "shift_name",
            "start_date",
            "end_date",
        ]

    def validate(self, attrs):
        employee = attrs.get("employee") or getattr(self.instance, "employee", None)
        start_date = attrs.get("start_date") or getattr(self.instance, "start_date", None)
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))

        overlapping = ShiftAssignment.objects.filter(employee=employee).exclude(
            pk=getattr(self.instance, "pk", None)
        )
        for other in overlapping:
            other_end = other.end_date or None
            if (other_end is None or start_date <= other_end) and (
                end_date is None or other.start_date <= end_date
            ):
                raise serializers.ValidationError(
                    "This employee already has a shift assignment overlapping these dates."
                )
        return attrs


class AttendanceEditLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceEditLog
        fields = ["id", "field", "from_value", "to_value", "actor_name", "created_at"]

    def get_actor_name(self, obj):
        if obj.actor is None:
            return None
        return obj.actor.get_full_name() or obj.actor.get_username()


# Defined above `AttendanceLogSerializer` because that one nests it. Order
# matters here in a way it does not for the rest of this file.



class AttendanceSessionSerializer(serializers.ModelSerializer):
    """One in-and-out. Duration is served rather than derived in the browser so
    two clients cannot disagree about how long a break was."""

    seconds_worked = serializers.IntegerField(read_only=True)
    is_open = serializers.BooleanField(read_only=True)

    class Meta:
        model = AttendanceSession
        fields = [
            "id",
            "check_in_time",
            "check_out_time",
            "source",
            "note",
            "seconds_worked",
            "is_open",
            # The system's guess, not somebody's punch. Served so the screen can
            # mark it — a tidy 18:00 that silently looks like a real clock-out
            # is the one thing the sweep must not produce.
            "auto_closed",
        ]


class AttendanceLogSerializer(serializers.ModelSerializer):
    """A day, and the punches it is actually made of.

    **`sessions` was missing and that was the whole gap.** `AttendanceSession`
    has stored every in-and-out since multi-punch landed — lunch, a client
    visit, an afternoon out — but this serializer exposed only the day row's
    `check_in_time` and `check_out_time`, which are the *first* in and the
    *last* out. So the data existed, was never wrong, and could not be seen:
    the only surface rendering punches was the clock widget, for the signed-in
    person, for today.

    **`seconds_worked` is not last-minus-first.** Somebody who clocks in at 9,
    leaves at 11 for four hours and returns until 6 shows a nine-hour day on
    the day row and a five-hour day here. Closed sessions only — an open one
    is still running, and a number that changes between two reads cannot be
    compared or tested (the same reasoning as `DaySummarySerializer`).
    """

    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    employee_name = serializers.SerializerMethodField()
    sessions = AttendanceSessionSerializer(many=True, read_only=True)
    seconds_worked = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceLog
        fields = [
            "id",
            "employee",
            "employee_code",
            "employee_name",
            "date",
            "check_in_time",
            "check_out_time",
            "source",
            "status",
            "notes",
            "sessions",
            "seconds_worked",
        ]
        read_only_fields = ["id", "employee", "date", "source"]

    def get_employee_name(self, obj):
        return obj.employee.user.get_full_name() or obj.employee.user.get_username()

    def get_seconds_worked(self, obj):
        return sum(
            int((s.check_out_time - s.check_in_time).total_seconds())
            for s in obj.sessions.all()
            if s.check_out_time
        )


class AttendanceDeviceEventSerializer(serializers.ModelSerializer):
    device_name = serializers.CharField(source="device.name", read_only=True, default=None)

    class Meta:
        model = AttendanceDeviceEvent
        fields = [
            "id",
            "device",
            "device_name",
            "reported_device_id",
            "external_employee_id",
            "event_type",
            "raw_timestamp",
            "raw_payload",
            "processed",
            "processed_at",
            "error",
        ]
        read_only_fields = ["id", "processed", "processed_at", "error"]


class DeviceSerializer(serializers.ModelSerializer):
    """Note what is absent: `secret_hash` is never exposed, in either
    direction. The plaintext token is returned exactly once, by the issue and
    rotate actions, and is unrecoverable afterwards."""

    device_type_label = serializers.CharField(source="get_device_type_display", read_only=True)
    event_count = serializers.IntegerField(source="events.count", read_only=True)

    class Meta:
        model = Device
        fields = [
            "id", "name", "serial", "device_type", "device_type_label",
            "ip_address", "port", "timezone_name", "location",
            "is_active", "last_seen_at", "event_count", "created_at",
        ]
        read_only_fields = ["id", "last_seen_at", "event_count", "created_at"]


class RegularisationRequestSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)
    employee_name = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = RegularisationRequest
        fields = [
            "id", "employee", "employee_code", "employee_name", "date",
            "requested_check_in", "requested_check_out", "requested_status",
            "reason", "status", "reviewed_by_name", "reviewed_at", "review_note",
            "created_at",
        ]
        # Status and the review fields move only through approve/reject, which
        # record who decided and when. A PATCH could set "approved" with nobody
        # having approved anything.
        read_only_fields = [
            "id", "employee", "status", "reviewed_by_name", "reviewed_at",
            "review_note", "created_at",
        ]

    def get_employee_name(self, obj):
        user = obj.employee.user
        return user.get_full_name() or user.get_username()

    def get_reviewed_by_name(self, obj):
        if obj.reviewed_by is None:
            return None
        return obj.reviewed_by.get_full_name() or obj.reviewed_by.get_username()

    def validate_reason(self, value):
        # Asking to change an attendance record without saying why leaves the
        # approver guessing, and the reason is what the decision is made on.
        if not value.strip():
            raise serializers.ValidationError("Say why this record should change.")
        return value

    def validate(self, attrs):
        if not any([
            attrs.get("requested_check_in"),
            attrs.get("requested_check_out"),
            attrs.get("requested_status"),
        ]):
            raise serializers.ValidationError(
                "Request at least one change — a check-in, a check-out, or a status."
            )
        return attrs
class DaySummarySerializer(serializers.Serializer):
    """A whole day of punches, in one response.

    Answers the clock widget's three questions in one response: am I in, since
    when, and how much have I done today. The day record alone answers only the
    first, and "how long have I been in?" is what people open the card for.

    `seconds_worked` counts **closed** sessions only. The running stretch is
    added by the screen from `open_since`, so this number does not change
    between two reads a second apart and can therefore be compared and tested.
    """

    date = serializers.DateField()
    status = serializers.CharField(allow_null=True)
    sessions = AttendanceSessionSerializer(many=True)
    seconds_worked = serializers.IntegerField()
    open_since = serializers.DateTimeField(allow_null=True)
    is_clocked_in = serializers.BooleanField()
    punches = serializers.IntegerField()
    #: How long a full day is for this person — their shift if assigned, else
    #: the company hours, minus the unpaid break. Null where no hours are set,
    #: which is a real state rather than a missing value.
    working_day_seconds = serializers.IntegerField(allow_null=True)
