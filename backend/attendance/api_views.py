"""Biometric device ingest.

This endpoint is necessarily session-less — a wall-mounted terminal has no
user to log in as — so authorisation is per-device: a token issued against a
`Device` row, hashed at rest, matched on every push.

Design notes worth keeping:

* Events are *staged*, never written straight to `AttendanceLog`. A punch that
  can't be matched to an employee must not be able to corrupt the canonical
  attendance record; resolution happens in a separate step.
* Failures are reported per-event rather than swallowed. The previous version
  caught every exception and silently dropped the row, which meant a device
  with a misconfigured payload appeared to be working for months.
* Auth failures return one indistinguishable message. Telling a caller the
  difference between "no such device" and "device disabled" is free
  reconnaissance.
"""

import hmac

from django.db import transaction
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from attendance.models import AttendanceDeviceEvent, Device, hash_device_secret

# One push should never be able to become an unbounded write. Real terminals
# batch a few dozen punches at most; anything larger is a mistake or an attack.
MAX_EVENTS_PER_PUSH = 500


class DeviceEventSerializer(serializers.Serializer):
    """Validates one punch. Deliberately strict — a device that sends garbage
    should find out immediately, not silently produce no attendance."""

    employee_id = serializers.CharField(max_length=100)
    event_type = serializers.ChoiceField(choices=AttendanceDeviceEvent.EventType.choices)
    timestamp = serializers.DateTimeField()
    device_id = serializers.CharField(max_length=100, required=False, allow_blank=True)


def _authenticate_device(request):
    """Resolve the pushing device, or None.

    Lookup is by token hash so there is no enumeration surface and no scan of
    the table; the explicit constant-time compare afterwards is defence in
    depth against a future change to how the row is fetched.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None

    raw_token = auth_header[len("Bearer "):].strip()
    if not raw_token:
        return None

    digest = hash_device_secret(raw_token)
    device = Device.objects.filter(secret_hash=digest, is_active=True).first()
    if device is None or not hmac.compare_digest(device.secret_hash, digest):
        return None
    return device


class HardwareSyncWebhook(APIView):
    """Accept a batch of punches from a registered attendance terminal.

    Class-based rather than `@api_view`: `throttle_scope` is only read off the
    view instance, and the function decorator does not carry it across.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "device_ingest"

    def post(self, request, *args, **kwargs):
        return _ingest(request)


def _ingest(request):
    device = _authenticate_device(request)
    if device is None:
        return Response(
            {"detail": "Unrecognised device credentials."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    data = request.data
    if isinstance(data, dict):
        payload = [data]
    elif isinstance(data, list):
        payload = data
    else:
        return Response(
            {"detail": "Expected a punch object or a list of them."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(payload) > MAX_EVENTS_PER_PUSH:
        return Response(
            {"detail": f"Too many events in one push (limit {MAX_EVENTS_PER_PUSH})."},
            status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        )

    accepted, rejected = [], []
    for index, raw_event in enumerate(payload):
        serializer = DeviceEventSerializer(data=raw_event)
        if not serializer.is_valid():
            rejected.append({"index": index, "errors": serializer.errors})
            continue
        accepted.append((serializer.validated_data, raw_event))

    if accepted:
        with transaction.atomic():
            AttendanceDeviceEvent.objects.bulk_create(
                [
                    AttendanceDeviceEvent(
                        device=device,
                        reported_device_id=validated.get("device_id") or device.serial,
                        external_employee_id=validated["employee_id"],
                        event_type=validated["event_type"],
                        raw_timestamp=validated["timestamp"],
                        raw_payload=raw_event,
                    )
                    for validated, raw_event in accepted
                ]
            )

    device.mark_seen()

    return Response(
        {
            "status": "accepted" if not rejected else "partial",
            "staged": len(accepted),
            "rejected": rejected,
        },
        # A push where every row was malformed is a client error, not a success.
        status=status.HTTP_201_CREATED if accepted else status.HTTP_400_BAD_REQUEST,
    )
