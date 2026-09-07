"""Meetings in every circumstance a meeting can be in.

**Why this is its own module.** A workflow with no examples is one nobody can
see working, and meetings have more states than any other module here: a
meeting is scheduled, over, or called off; you either called it or were invited
to it; and behind each one sits an agenda, a register, decisions people have
consented to or dissented from, and a minute that is draft, circulated or
final. Twelve rows covering the corners are worth more than a hundred rows of
one shape.

Run it with `python manage.py seed_meetings`, or let `seed_hydro` call it as
part of a full seed. It is idempotent — meetings are matched on title, so
running it twice adds nothing and changes nothing.
"""

import io
from datetime import timedelta

from django.utils import timezone

# One-pixel PNG. Enough to be a real `ImageField` value, which is all an
# approved signature needs to exist — consent will not record without one.
_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
    b"\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05"
    b"\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _say(stdout, line):
    if stdout is not None:
        stdout.write(line)


def _approved_signature(employee, actor):
    """An approved signature, so this person's consent can actually be recorded.

    `record_position` refuses a consent with nothing to stamp — agreeing is
    signing your name to something — so a seed that wants consents on file has
    to give people something to sign with.
    """
    from django.core.files.base import ContentFile

    from employees.models import Signature

    existing = Signature.objects.filter(
        employee=employee, status=Signature.Status.APPROVED
    ).first()
    if existing:
        return existing
    signature = Signature.objects.create(
        employee=employee,
        status=Signature.Status.APPROVED,
        decided_by=actor,
        decided_at=timezone.now(),
        created_by=actor,
        updated_by=actor,
    )
    signature.image.save(
        f"seed-{employee.pk}.png", ContentFile(io.BytesIO(_PNG).read()), save=True
    )
    return signature


def _employee_for(user, companies, stdout=None):
    """The person behind the account, created if the account is not one yet.

    **An invitation goes to an employee, not to a login.** The demo account is
    frequently an owner who was never added to the roster, and without a record
    they cannot appear in a single attendee list — so half the circumstances
    this module exists to show would be unreachable for the person looking at
    it. A managing director who is also on the roster is an ordinary thing.
    """
    from employees.models import Employee

    employee = Employee.objects.filter(user=user).first()
    if employee:
        return employee

    code = f"OWN-{user.pk:04d}"
    employee = Employee.objects.create(
        user=user,
        employee_code=code,
        date_joined=timezone.now().date() - timedelta(days=365),
        primary_company=companies[0] if companies else None,
        created_by=user,
        updated_by=user,
    )
    _say(
        stdout,
        f"  · gave {user.get_username()} an employee record ({code}) — "
        "an invitation goes to a person, not a login",
    )
    return employee


def seed_meetings(for_username="owner", stdout=None):
    """Twelve meetings: every state, from both sides of the table.

    Three states — scheduled, ended, cancelled — times two roles — you called
    it, or you were invited — times two examples each, because one of anything
    reads as a special case.

    Within that, the things a meeting *produces* are varied deliberately: an
    agenda that grew in the room, a register with somebody absent, decisions in
    all three of draft, circulated and closed, positions covering consent,
    dissent, abstention and not-yet-answered, and minutes in draft, circulated
    and final. The point is not the count of rows; it is that every screen in
    the module has something real to show.
    """
    from django.contrib.auth import get_user_model

    from companies.models import Company
    from employees.models import Employee
    from notifications import services
    from notifications.models import (
        AgendaItem,
        CompanyEvent,
        DecisionPosition,
        MeetingAttendee,
        MeetingDecision,
        MeetingMinutes,
    )

    User = get_user_model()
    me_user = User.objects.filter(username=for_username).first()
    if me_user is None:
        _say(stdout, f"  · no user {for_username!r} — nothing seeded")
        return 0

    companies = list(Company.objects.order_by("pk"))
    me = _employee_for(me_user, companies, stdout=stdout)

    # Colleagues to fill the room, and somebody else to be the organiser of the
    # meetings this account was merely invited to.
    others = list(
        Employee.objects.filter(user__is_active=True)
        .exclude(pk=me.pk)
        .select_related("user")
        .order_by("employee_code")[:6]
    )
    if len(others) < 3:
        _say(stdout, "  · fewer than three other employees — nothing seeded")
        return 0
    host = others[0]
    room = [me] + others[:4]
    company = me.primary_company or (companies[0] if companies else None)

    now = timezone.now()

    def make(title, *, days, hours, organiser, invited, where, description, at=10):
        """One meeting, or the one that is already there.

        Matched on title so the command can be run repeatedly — a seed that
        duplicates its own data on the second run is one nobody dares run.

        **`at` is the hour of the day, and it matters.** Offsetting from "now"
        alone gave a budget working session at ten at night, which is the kind
        of detail that makes demonstration data read as fake and stops people
        trusting what they are looking at. Meetings happen in office hours.
        """
        existing = CompanyEvent.objects.filter(
            title=title, event_type=CompanyEvent.EventType.MEETING
        ).first()
        if existing:
            return existing, False
        starts = (now + timedelta(days=days)).replace(
            hour=at, minute=0, second=0, microsecond=0
        )
        meeting = CompanyEvent.objects.create(
            title=title,
            description=description,
            event_type=CompanyEvent.EventType.MEETING,
            start_datetime=starts,
            end_datetime=starts + timedelta(hours=hours),
            location=where,
            company=company,
            created_by=organiser.user,
            updated_by=organiser.user,
        )
        for person in invited:
            MeetingAttendee.objects.create(
                event=meeting,
                employee=person,
                created_by=organiser.user,
                updated_by=organiser.user,
            )
        return meeting, True

    def agenda(meeting, items):
        for order, (heading, presenter, in_room) in enumerate(items):
            AgendaItem.objects.create(
                meeting=meeting,
                order=order,
                title=heading,
                presenter=presenter,
                raised_in_meeting=in_room,
                created_by=meeting.created_by,
                updated_by=meeting.created_by,
            )

    def rsvp(meeting, answers):
        """`answers` maps a position in the room to a reply; the rest stay
        pending, which is what most invitations look like most of the time."""
        rows = list(meeting.attendees.select_related("employee"))
        for index, answer in answers.items():
            if index < len(rows):
                rows[index].rsvp_status = answer
                rows[index].save(update_fields=["rsvp_status"])

    def register(meeting, absent_indexes=(), unmarked_indexes=()):
        """Take the register. Anyone left unmarked stays unmarked on purpose —
        "we did not record it" and "they did not come" are different facts."""
        rows = list(meeting.attendees.select_related("employee"))
        for index, row in enumerate(rows):
            if index in unmarked_indexes:
                continue
            row.attendance = (
                MeetingAttendee.Attendance.ABSENT
                if index in absent_indexes
                else MeetingAttendee.Attendance.PRESENT
            )
            row.attendance_marked_at = meeting.end_datetime
            row.save(update_fields=["attendance", "attendance_marked_at"])

    def decide(meeting, text, *, order=0, circulate=False):
        decision = MeetingDecision.objects.create(
            meeting=meeting,
            order=order,
            text=text,
            created_by=meeting.created_by,
            updated_by=meeting.created_by,
        )
        if circulate:
            services.circulate_decision(decision, actor=meeting.created_by)
        return decision

    def answer(decision, employee, position, reason=""):
        """One person's position, recorded through the service so the rules
        that make a position worth reading are the ones that applied."""
        row = DecisionPosition.objects.filter(
            decision=decision, employee=employee
        ).first()
        if row is None:
            return
        if position == DecisionPosition.Position.CONSENT:
            _approved_signature(employee, decision.meeting.created_by)
        services.record_position(
            row, position=position, reason=reason, actor=employee.user
        )

    def minute(meeting, status):
        """Draft it from the template, then move it as far as asked.

        Drafted rather than typed, because that is how the product does it: the
        register and the decisions are already known and retyping them is how a
        minute comes to disagree with the record it summarises.
        """
        if hasattr(meeting, "minutes"):
            return meeting.minutes
        template = services.default_minutes_template()
        row = MeetingMinutes.objects.create(
            meeting=meeting,
            company=meeting.company,
            template=template,
            content=services.build_minutes_body(meeting, template),
            created_by=meeting.created_by,
            updated_by=meeting.created_by,
        )
        if status != MeetingMinutes.Status.DRAFT:
            services.mint_minute_id(row)
            row.refresh_from_db()
            row.status = status
            if status == MeetingMinutes.Status.FINAL:
                row.finalised_at = meeting.end_datetime + timedelta(days=2)
            row.save(update_fields=["status", "finalised_at"])
        return row

    made = 0

    # ── Scheduled, and I called it ───────────────────────────────────────
    #
    # The commonest thing in the module and the one everything else grows out
    # of: a meeting that has not happened yet. One with an agenda circulated
    # and replies coming in, one just called with nothing on it — which is
    # also a real state, and the one an empty agenda tab has to look right in.

    meeting, new = make(
        "Monthly progress review — Bhadra",
        days=6, hours=2, organiser=me, invited=room,
        where="Head office, Butwal",
        description="Standing monthly review of the construction programme.",
        at=10,
    )
    if new:
        agenda(meeting, [
            ("Minutes of the last meeting", None, False),
            ("Progress against the programme", others[0], False),
            ("Contractor's claim for extension of time", others[1], False),
            ("Any other business", None, False),
        ])
        rsvp(meeting, {1: "accepted", 2: "accepted", 3: "declined"})
        made += 1

    meeting, new = make(
        "Safety stand-down before the monsoon",
        days=11, hours=1, organiser=me, invited=room[:4],
        where="Site office, Sanjen",
        description="Called after the near-miss at the adit. Agenda to follow.",
        at=8,
    )
    if new:
        made += 1  # No agenda, no replies yet. Deliberately bare.

    # ── Scheduled, and I was invited ─────────────────────────────────────
    #
    # The Accept/Decline buttons only exist on an invitation that is still
    # pending, so one of these has to be.

    meeting, new = make(
        "Board meeting — third quarter",
        days=9, hours=3, organiser=host, invited=room,
        where="Head office, Butwal",
        description="Quarterly board meeting. Papers circulated a week ahead.",
        at=11,
    )
    if new:
        agenda(meeting, [
            ("Chairman's opening remarks", host, False),
            ("Quarterly accounts", others[1], False),
            ("Progress on the Sanjen headworks", me, False),
        ])
        rsvp(meeting, {0: "accepted", 2: "accepted"})
        made += 1

    meeting, new = make(
        "Insurance renewal — broker presentation",
        days=3, hours=1, organiser=host, invited=room,
        where="Video call",
        description="The broker will walk through the renewal terms.",
        at=15,
    )
    if new:
        agenda(meeting, [("Renewal terms and premium", host, False)])
        made += 1  # My reply left pending, so the buttons are live.

    # ── Over, and I called it ────────────────────────────────────────────
    #
    # The whole process, end to end, and the same process stopped half way —
    # because a module that only ever shows finished work never shows anybody
    # what the middle looks like.

    meeting, new = make(
        "Monthly progress review — Shrawan",
        days=-21, hours=2, organiser=me, invited=room,
        where="Head office, Butwal",
        description="Standing monthly review of the construction programme.",
        at=10,
    )
    if new:
        agenda(meeting, [
            ("Minutes of the last meeting", None, False),
            ("Progress against the programme", others[0], False),
            ("Access road washout at ch. 1400", others[1], True),
        ])
        rsvp(meeting, {0: "accepted", 1: "accepted", 2: "accepted", 3: "declined"})
        register(meeting, absent_indexes={3})
        first = decide(
            meeting,
            "That the access road culvert be rebuilt before the monsoon, "
            "and the cost met from the contingency.",
            order=0, circulate=True,
        )
        answer(first, me, DecisionPosition.Position.CONSENT)
        answer(first, others[0], DecisionPosition.Position.CONSENT)
        answer(
            first, others[1], DecisionPosition.Position.DISSENT,
            reason="The contingency is already committed to the penstock. "
                   "This should go to the board as a variation.",
        )
        answer(first, others[2], DecisionPosition.Position.ABSTAIN)
        second = decide(
            meeting,
            "That the monthly review move to the first Sunday of each month.",
            order=1, circulate=True,
        )
        answer(second, me, DecisionPosition.Position.CONSENT)
        answer(second, others[0], DecisionPosition.Position.CONSENT)
        minute(meeting, MeetingMinutes.Status.FINAL)
        made += 1

    meeting, new = make(
        "Contractor coordination — Sanjen headworks",
        days=-9, hours=2, organiser=me, invited=room[:4],
        where="Site office, Sanjen",
        description="Coordination with the civil contractor on the headworks.",
        at=14,
    )
    if new:
        agenda(meeting, [
            ("Programme slippage on the intake", others[0], False),
            ("Labour camp sanitation", None, True),
        ])
        # The register taken but one person never marked, and a decision still
        # being drafted — nobody has been asked to sign anything yet.
        register(meeting, absent_indexes={2}, unmarked_indexes={3})
        decide(
            meeting,
            "That the contractor submit a recovery programme within fourteen days.",
            order=0, circulate=False,
        )
        made += 1

    # ── Over, and I was invited ──────────────────────────────────────────
    #
    # One with a decision still sitting with me — the case the module exists
    # for, and the only way to see the answer form as the person answering.

    meeting, new = make(
        "Management committee — Ashadh",
        days=-14, hours=2, organiser=host, invited=room,
        where="Head office, Butwal",
        description="Monthly management committee.",
        at=11,
    )
    if new:
        agenda(meeting, [
            ("Recruitment for the O&M team", others[1], False),
            ("Vehicle replacement", others[2], False),
        ])
        rsvp(meeting, {0: "accepted", 1: "accepted"})
        register(meeting, absent_indexes={4})
        pending = decide(
            meeting,
            "That two operators be recruited on contract for the first year of "
            "operation, and confirmed subject to performance.",
            order=0, circulate=True,
        )
        # Everybody else has answered; mine is the one still open.
        answer(pending, others[0], DecisionPosition.Position.CONSENT)
        answer(pending, others[1], DecisionPosition.Position.CONSENT)
        answer(
            pending, others[2], DecisionPosition.Position.DISSENT,
            reason="Two is short-staffed for a two-shift operation. Three, or "
                   "one plus a standing contract for relief cover.",
        )
        minute(meeting, MeetingMinutes.Status.DRAFT)
        made += 1

    meeting, new = make(
        "Annual general meeting",
        days=-45, hours=4, organiser=host, invited=room,
        where="Hotel Pauwa, Butwal",
        description="Annual general meeting of the shareholders.",
        at=10,
    )
    if new:
        agenda(meeting, [
            ("Directors' report", host, False),
            ("Audited accounts", others[1], False),
            ("Appointment of auditors", host, False),
        ])
        rsvp(meeting, {0: "accepted", 1: "accepted", 2: "accepted", 3: "accepted"})
        register(meeting)
        closed = decide(
            meeting,
            "That the audited accounts for the year be adopted.",
            order=0, circulate=True,
        )
        answer(closed, me, DecisionPosition.Position.CONSENT)
        for person in others[:3]:
            answer(closed, person, DecisionPosition.Position.CONSENT)
        closed.status = MeetingDecision.Status.CLOSED
        closed.save(update_fields=["status"])
        minute(meeting, MeetingMinutes.Status.CIRCULATED)
        made += 1

    # ── Called off ───────────────────────────────────────────────────────
    #
    # Cancelled rather than deleted: the agenda, the register and the reason
    # survive, which is the whole argument for the state existing. One called
    # off before it happened and one after its time had passed — the second
    # being the awkward case, where people may already have turned up.

    meeting, new = make(
        "Site inspection with the lenders' engineer",
        days=4, hours=5, organiser=me, invited=room,
        where="Sanjen headworks",
        description="Quarterly inspection with the lenders' independent engineer.",
        at=8,
    )
    if new:
        agenda(meeting, [("Walk the intake and the headrace", others[0], False)])
        rsvp(meeting, {1: "accepted", 2: "accepted"})
        services.cancel_meeting(
            meeting,
            reason="The lenders' engineer is held up in Kathmandu; rescheduling "
                   "for the following week.",
            actor=me.user,
        )
        made += 1

    meeting, new = make(
        "Budget working session",
        days=-5, hours=3, organiser=me, invited=room[:4],
        where="Head office, Butwal",
        description="Working session on next year's operating budget.",
        at=14,
    )
    if new:
        agenda(meeting, [
            ("Operating budget, first pass", others[0], False),
            ("Establishment and headcount", None, False),
        ])
        services.cancel_meeting(
            meeting,
            reason="Called off on the morning — the finance manager was on leave "
                   "and the draft was not ready.",
            actor=me.user,
        )
        made += 1

    meeting, new = make(
        "Training needs assessment",
        days=7, hours=2, organiser=host, invited=room,
        where="Head office, Butwal",
        description="Assessment of training needs for the operations team.",
        at=13,
    )
    if new:
        rsvp(meeting, {0: "accepted"})
        services.cancel_meeting(
            meeting,
            reason="Folded into the management committee agenda instead.",
            actor=host.user,
        )
        made += 1

    meeting, new = make(
        "Emergency response drill briefing",
        days=-2, hours=1, organiser=host, invited=room,
        where="Site office, Sanjen",
        description="Briefing ahead of the annual emergency response drill.",
        at=9,
    )
    if new:
        agenda(meeting, [("Drill scenario and roles", host, False)])
        services.cancel_meeting(
            meeting,
            reason="Postponed — the drill itself moved to next month.",
            actor=host.user,
        )
        made += 1

    _say(
        stdout,
        f"  · {made} meetings across scheduled, ended and cancelled, "
        f"from both sides of the table (as {for_username})",
    )
    return made
