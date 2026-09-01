# `attendance` app

Company-scoped.

## Models

- **`Shift`** — start/end time, grace-period minutes (for late detection).
- **`ShiftAssignment`** — date-ranged (`start_date`, nullable `end_date`
  = ongoing) employee-to-shift mapping. Deliberately date-ranged rather
  than a single current-shift FK on `Employee`, so shift rotations and
  "what shift were they on last month" both just work.
- **`AttendanceLog`** — one row per employee per day (unique constraint).
  `source` (web/manual/biometric/system) and `status`
  (present/late/absent/half_day), the latter computed by
  `services.compute_check_in_status()` — shared between the self-service
  check-in endpoint and device-event processing, so late/present logic
  only exists in one place.
- **`AttendanceEditLog`** — append-only correction history (who/when,
  field, from/to), same pattern as `employees.EmployeeLog`. Only fires on
  HR corrections, not on the record's own creation (that's already
  covered by `created_by`).
- **`AttendanceDeviceEvent`** — raw staging table bridging future
  biometric device sync. **No create endpoint exists for it** — an open
  API would let anyone inject a fake check-in for any employee. Rows are
  only ever created by the `process_attendance_device_events` management
  command (standing in for a real device integration, which doesn't
  exist yet).

## The same-day edit lock

Writes to `AttendanceLog` are only allowed for the **current day**, for
everyone including HR (`permissions.AttendanceLogPermission`, checked
ahead of any role logic — can't be bypassed by admin/superuser status).
Attendance isn't meant to be retroactively rewritten; yesterday's record
is history once the day ends. The frontend mirrors this with a lock icon
instead of an edit action on any non-today row.

## Endpoints (`/api/v1/attendance/`)

| Endpoint | Purpose |
|---|---|
| `GET/POST shifts/`, `shift-assignments/` | HR-managed |
| `POST logs/check-in/`, `POST logs/check-out/` | Self-service, resolves "your" employee from the logged-in user |
| `GET logs/my-today/` | Your attendance for today, or `null` |
| `GET logs/` | HR: everyone. Manager: self + direct reports. Employee: self only |
| `PATCH logs/{id}/` | HR correction, today's date only (see above) |
| `GET logs/{id}/edit_logs/` | Correction history |
| `GET device-events/` | HR-only, read-only |
| `GET calendar/?start=&end=&employee=` | Phase 8 — merged day-by-day status grid (see below) |

No plain `create`/`delete` on `logs/` at all — the viewset composes
`ListModelMixin`/`RetrieveModelMixin`/`UpdateModelMixin` directly rather
than `ModelViewSet`, so this is enforced by routing, not just
permissions. (Don't use `http_method_names` to try to achieve the same
thing — it blocks custom `@action` methods too; see `docs/development-plan.md`.)

## Calendar aggregation (`views.AttendanceCalendarView`, Phase 8)

A plain `APIView` (not a viewset — it's a read-only aggregation, not a
model's CRUD), backing the frontend's employee-rows × day-columns
calendar grid. Merges three sources server-side rather than making the
frontend stitch them together and reimplement precedence rules:

`AttendanceLog.status` for that day, overridden by `"on_leave"` for any
day inside an *approved* `LeaveRequest` span, itself overridden by
`"holiday"` for any company `Holiday` date (applies to every employee,
not just one). A date with none of these is simply absent from the
response — deliberately not defaulted to `"absent"` for weekends, since
this app doesn't hardcode which day(s) are the weekend (see
`docs/development-plan.md` on avoiding country-specific assumptions baked into the
system). Scoping matches every other attendance/leave endpoint: HR sees
everyone, a manager sees self + direct reports, an employee sees only
themselves.

## Management commands (standing in for Celery Beat)

```
python manage.py process_attendance_device_events <schema_name>
python manage.py mark_absent_employees <schema_name> [--date YYYY-MM-DD]
```

Real Celery infra didn't exist yet when this app was built (Phase 3) —
these are invoked manually/via external cron for now. `leave` (Phase 4)
is where Celery actually gets stood up; migrating these to Beat periodic
tasks afterward is straightforward (see `core/README.md`'s `a plain `@shared_task``).

## Device registry and the ingest contract

A wall-mounted terminal has no user to log in as, so the ingest endpoint is
necessarily session-less. Authorisation is therefore **per device**.

> **History worth keeping.** This endpoint originally shipped as `AllowAny`
> and accepted *any* `Bearer` token — its own comment admitted it. Anyone on
> the internet could write attendance events into any company. The registry
> below is what closed that.

### Registering a terminal

Via the console: **Settings → Organization → Attendance devices** (HR admin).
Via the CLI, when there's no UI to hand:

```
python manage.py register_device --schema acme \
    --name "Main gate" --serial ZK-8821 --type zkteco
```

Both print the push token **once**. Only a SHA-256 hash is stored, so a lost
token is not recoverable — rotate and reconfigure the device instead.

A plain digest is the right primitive here rather than a password KDF: the
token is machine-generated and high-entropy, so there is nothing to
brute-force, and a terminal pushing every 30 seconds must not cost a PBKDF2
round per request. That would turn our own authentication into a
denial-of-service lever.

### The contract

```
POST /api/v1/attendance/device-sync/
Authorization: Bearer <token>
Content-Type: application/json

{"employee_id": "EMP-001",
 "event_type": "check_in",
 "timestamp": "2026-08-05T09:14:00Z"}
```

A JSON array of the same shape is also accepted, capped at
`MAX_EVENTS_PER_PUSH` (500) so one POST cannot become an unbounded write.
`employee_id` matches `Employee.employee_code`; `event_type` is `check_in`
or `check_out`; `timestamp` is anything DRF can parse, ideally ISO-8601 with
an offset. `device_id` is optional and defaults to the device's serial.

| Response | When |
|---|---|
| `201` `{"status": "accepted", "staged": n, "rejected": []}` | all punches valid |
| `201` `{"status": "partial", ...}` | some valid, per-event errors listed |
| `400` | every punch malformed, or the body is neither object nor array |
| `401` | unknown token, wrong token, or a deactivated device |
| `413` | more than `MAX_EVENTS_PER_PUSH` events |

Two deliberate choices:

- **Auth failures are indistinguishable.** Unknown device and disabled device
  return byte-identical bodies. Telling a caller which is free reconnaissance.
- **Rejections are reported, not swallowed.** The original implementation
  caught every exception per row and continued, so a device sending a
  malformed payload appeared healthy for months while producing no
  attendance. Each bad event now comes back with its index and errors.

### What happens next

Accepted events are **staged**, never written straight to `AttendanceLog` —
a punch that can't be matched to an employee must not be able to corrupt the
canonical record. `process_attendance_device_events` resolves them.

**Known gap:** that resolver assigns a punch to `localtime(ts).date()`, and
`services.compute_check_in_status` builds its lateness threshold with
`datetime.combine(on_date, shift.start_time)`. Neither is shift-aware, so a
shift crossing midnight books its check-out to the following day. Tracked as
P6.5 in `docs/remaining-work.md`; do not describe night shifts as supported
until it lands.

Vendor-specific drivers (ZKTeco ADMS, Hikvision) are **not** shipped. The
`device_type` field records intent; every type currently uses the push
endpoint above.
