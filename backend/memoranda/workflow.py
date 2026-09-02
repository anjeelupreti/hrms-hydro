"""Moving a memorandum, and refusing to move it wrongly.

**Every transition is here and nowhere else.** The viewset finds the memo,
checks who is asking, and calls one of these; it never sets `stage`,
`current_holder` or `current_index` itself. Those three have to move together —
a memo whose holder and stage disagree is one that either sits on nobody's desk
or on two — and the only way to guarantee that is for one module to own them.

**The cursor moves both ways, and that is the whole design.** `current_index`
is a position in the recommender chain. Proceeding advances it; returning sets
it back to whoever was chosen, and the memo then comes forward again through
the same people. There is no separate "returned" state to get stuck in: a
returned memo is simply one whose cursor moved backwards, which is why the loop
can run any number of times without any state to unwind.
"""

from __future__ import annotations

from datetime import date

from django.db import transaction
from django.utils import timezone

from memoranda.models import (
    Memorandum,
    MemorandumAction,
    MemorandumCounter,
    MemorandumEvent,
    MemorandumRecommender,
)


class MemorandumError(Exception):
    """The memorandum cannot be moved as asked."""


# ── Naming people ────────────────────────────────────────────────────────


def _label(employee):
    if employee is None:
        return "System"
    user = employee.user
    return user.get_full_name() or user.get_username()


def _role_of(memo, employee):
    """What this person is on this memo, if anything."""
    if employee is None:
        return ""
    if memo.initiator_id == employee.pk:
        return "initiator"
    if memo.approver_id == employee.pk:
        return "approver"
    if memo.recommenders.filter(employee=employee).exists():
        return "recommender"
    return ""


def log(memo, kind, *, actor=None, employee=None, action=None, comment="", returned_to=None):
    """Write one line of the memorandum's history.

    `actor_label` and `action_label` are frozen here rather than joined at read
    time: a person can be renamed and a configured action reworded, and the log
    has to keep saying what it said on the day.
    """
    return MemorandumEvent.objects.create(
        memorandum=memo,
        kind=kind,
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        actor_employee=employee,
        actor_label=_label(employee) or (actor.get_username() if actor else "System"),
        role=_role_of(memo, employee),
        action=action,
        action_label=action.name if action else "",
        comment=comment or "",
        returned_to=returned_to,
    )


def has_ever_acted(memo, employee) -> bool:
    """Has this person handled this memorandum at any point?

    Read from the log rather than a flag on the chain row, because a return
    would have to clear such a flag — and the question the rule needs answered
    is "have they *ever*", not "have they since the last loop".
    """
    return memo.events.filter(
        actor_employee=employee,
        kind__in=[
            MemorandumEvent.Kind.PROCEEDED,
            MemorandumEvent.Kind.RETURNED,
            MemorandumEvent.Kind.APPROVED,
            MemorandumEvent.Kind.REJECTED,
        ],
    ).exists()


# ── The chain ────────────────────────────────────────────────────────────


def set_chain(memo, employee_ids, *, actor=None):
    """Replace the recommender chain, in the order given.

    **Two rules, and both come from the same place:** somebody who has already
    handled this memorandum cannot be taken off it, and neither can the person
    holding it right now. Their comment is part of the record and the chain is
    what that comment is attached to — removing them would leave a signature on
    a document that no longer says they were involved.

    Adding and reordering *ahead* of the cursor is allowed and is the normal
    case: a memo comes back from the site engineer saying "finance should see
    this too", and the initiator adds them.

    Renumbered densely from zero every time, so `current_index` stays a plain
    index rather than something that has to search.
    """
    if memo.is_locked:
        raise MemorandumError("This memorandum has been decided and cannot be changed.")

    employee_ids = list(dict.fromkeys(int(i) for i in employee_ids))  # de-duplicate, keep order

    existing = {r.employee_id: r for r in memo.recommenders.select_related("employee__user")}
    for employee_id, row in existing.items():
        if employee_id in employee_ids:
            continue
        if has_ever_acted(memo, row.employee):
            raise MemorandumError(
                f"{_label(row.employee)} has already handled this memorandum and "
                "cannot be removed from the chain."
            )
        if memo.current_holder_id == employee_id:
            raise MemorandumError(
                f"{_label(row.employee)} is holding this memorandum right now and "
                "cannot be removed. Ask them to send it back first."
            )

    if memo.initiator_id in employee_ids:
        raise MemorandumError("The initiator cannot also be a recommender.")
    if memo.approver_id and memo.approver_id in employee_ids:
        raise MemorandumError("The approver cannot also be a recommender.")

    with transaction.atomic():
        memo.recommenders.exclude(employee_id__in=employee_ids).delete()
        for index, employee_id in enumerate(employee_ids):
            MemorandumRecommender.objects.update_or_create(
                memorandum=memo,
                employee_id=employee_id,
                defaults={"order": index, "updated_by": actor},
            )
        # Reordering can move somebody who has acted, which would make the
        # cursor point at the wrong person. Anchored on the current holder
        # instead, so the memo stays where it is however the tail was redrawn.
        if memo.stage == Memorandum.Stage.RECOMMEND and memo.current_holder_id:
            row = memo.recommenders.filter(employee_id=memo.current_holder_id).first()
            if row is not None:
                memo.current_index = row.order
                memo.save(update_fields=["current_index", "updated_at"])
    return memo.chain


def set_approver(memo, employee, *, actor=None):
    """Name or change the approver.

    Changeable right up until the memo reaches them — at which point they are
    reading it, and swapping the person mid-read would take a document off
    somebody's desk with no explanation.
    """
    if memo.is_locked:
        raise MemorandumError("This memorandum has been decided and cannot be changed.")
    if memo.stage == Memorandum.Stage.APPROVE:
        raise MemorandumError(
            "This memorandum is already with the approver. It has to be sent back "
            "before the approver can be changed."
        )
    if employee is not None and memo.recommenders.filter(employee=employee).exists():
        raise MemorandumError("The approver cannot also be a recommender.")
    if employee is not None and employee.pk == memo.initiator_id:
        raise MemorandumError("The initiator cannot approve their own memorandum.")
    memo.approver = employee
    memo.updated_by = actor
    memo.save(update_fields=["approver", "updated_by", "updated_at"])
    return memo


# ── Submitting ───────────────────────────────────────────────────────────


def _next_serial(company):
    """The company's next memorandum number, taken under a row lock."""
    counter, _ = MemorandumCounter.objects.get_or_create(company=company)
    counter = MemorandumCounter.objects.select_for_update().get(pk=counter.pk)
    serial = counter.next_serial
    counter.next_serial = serial + 1
    counter.save(update_fields=["next_serial"])
    return serial


@transaction.atomic
def submit(memo, *, actor=None, on_date=None):
    """Send a draft into the chain, and give it its number.

    **The date has to be today.** A memorandum is dated the day it is raised;
    one dated last week and submitted now is either a mistake or a register
    being quietly rewritten, and neither is worth accommodating. The frontend
    fills the field in with today's date, so this refuses only a deliberate
    change.

    The id is minted here rather than at creation, because a draft that is
    abandoned should not consume a number out of the company's register — the
    gap would be unexplainable a year later.
    """
    if memo.status != Memorandum.Status.DRAFT:
        raise MemorandumError("This memorandum has already been submitted.")
    if not memo.subject.strip():
        raise MemorandumError("A memorandum needs a subject.")
    if not (memo.content or "").strip():
        raise MemorandumError("A memorandum needs some content.")
    if memo.company_id is None:
        raise MemorandumError("Choose the company this memorandum belongs to.")

    today = on_date or date.today()
    if memo.memo_date != today:
        raise MemorandumError(
            f"The memorandum is dated {memo.memo_date:%d %b %Y} but today is "
            f"{today:%d %b %Y}. A memorandum is dated the day it is submitted."
        )

    chain = memo.chain
    if not chain and memo.approver_id is None:
        raise MemorandumError(
            "Name at least one recommender, or an approver, before submitting."
        )

    serial = _next_serial(memo.company)
    memo.serial_number = serial
    memo.memo_id = f"{memo.memo_date:%Y-%m-%d}-{memo.company.code}-{serial:04d}"
    memo.status = Memorandum.Status.IN_PROGRESS
    memo.submitted_at = timezone.now()
    memo.updated_by = actor
    _place_at(memo, 0)
    memo.save()

    log(memo, MemorandumEvent.Kind.SUBMITTED, actor=actor, employee=memo.initiator)
    _announce(memo)
    return memo


def _place_at(memo, index):
    """Put the cursor at a position in the chain, or past its end.

    One function, because "where is it now" is three fields and setting two of
    them is how a memo ends up on nobody's desk. Past the end of the chain means
    the approver; no approver either means there is nowhere left to go, which
    `submit` has already refused.
    """
    chain = memo.chain
    if index < len(chain):
        memo.stage = Memorandum.Stage.RECOMMEND
        memo.current_index = index
        memo.current_holder = chain[index].employee
    else:
        memo.stage = Memorandum.Stage.APPROVE
        memo.current_index = len(chain)
        memo.current_holder = memo.approver


# ── Handling ─────────────────────────────────────────────────────────────


def _require_holder(memo, employee):
    if memo.is_locked:
        raise MemorandumError("This memorandum has been decided.")
    if memo.status != Memorandum.Status.IN_PROGRESS:
        raise MemorandumError("This memorandum has not been submitted.")
    if employee is None or memo.current_holder_id != employee.pk:
        raise MemorandumError("This memorandum is not with you.")


@transaction.atomic
def proceed(memo, employee, *, action, comment="", actor=None):
    """Send it on, in whatever word the organisation uses.

    The word comes from `MemorandumAction`; the machinery reads only its
    `effect`. A recommender proceeding moves the cursor one step, which lands
    on the next recommender or on the approver.
    """
    _require_holder(memo, employee)
    if action is None or action.effect != MemorandumAction.Effect.PROCEED:
        raise MemorandumError("Choose what to record — recommended, noted, verified.")
    if memo.stage == Memorandum.Stage.APPROVE:
        raise MemorandumError(
            "The approver decides rather than passing it on. Approve, reject or send it back."
        )

    _place_at(memo, memo.current_index + 1)
    memo.updated_by = actor
    memo.save(update_fields=["stage", "current_index", "current_holder", "updated_by", "updated_at"])
    log(
        memo, MemorandumEvent.Kind.PROCEEDED,
        actor=actor, employee=employee, action=action, comment=comment,
    )
    _announce(memo)
    return memo


def eligible_return_targets(memo):
    """Who this memorandum can be sent back to.

    The initiator, always — that is the default and the common case. Plus
    anybody earlier in the chain than the cursor, because they have seen it and
    can be asked to look again. Never somebody ahead of the cursor: that would
    be sending it *forward* while calling it a return, and the log would then
    read as though the chain ran backwards.
    """
    targets = [memo.initiator]
    for row in memo.chain[: memo.current_index]:
        targets.append(row.employee)
    return targets


@transaction.atomic
def send_back(memo, employee, *, to, action=None, comment="", actor=None):
    """Send it back to somebody who has already seen it.

    The memo then comes forward again *from there* — through the same people,
    in the same order. That is why this only moves the cursor and changes no
    status: there is no "returned" state to climb out of, so the loop can run
    as many times as it needs to.
    """
    _require_holder(memo, employee)
    if action is not None and action.effect != MemorandumAction.Effect.RETURN:
        raise MemorandumError(f"“{action.name}” is not a way of sending a memorandum back.")

    targets = {t.pk for t in eligible_return_targets(memo)}
    if to is None or to.pk not in targets:
        raise MemorandumError(
            "A memorandum can only be sent back to its initiator or to somebody "
            "who has already handled it."
        )

    if to.pk == memo.initiator_id:
        memo.stage = Memorandum.Stage.RECOMMEND
        memo.current_index = 0
        memo.current_holder = memo.initiator
    else:
        row = memo.recommenders.filter(employee=to).first()
        _place_at(memo, row.order)

    memo.updated_by = actor
    memo.save(update_fields=["stage", "current_index", "current_holder", "updated_by", "updated_at"])
    log(
        memo, MemorandumEvent.Kind.RETURNED,
        actor=actor, employee=employee, action=action, comment=comment, returned_to=to,
    )
    _announce(memo)
    return memo


@transaction.atomic
def resubmit(memo, employee, *, comment="", actor=None):
    """The initiator sends a returned memorandum forward again.

    Distinct from `submit`: the number is already minted and the chain already
    drawn, so this only moves the cursor back to the first recommender. The
    memo then climbs the same chain, and everybody who commented before
    comments again — which is the point of sending it back.
    """
    _require_holder(memo, employee)
    if employee.pk != memo.initiator_id:
        raise MemorandumError("Only the initiator sends a returned memorandum forward again.")

    _place_at(memo, 0)
    memo.updated_by = actor
    memo.save(update_fields=["stage", "current_index", "current_holder", "updated_by", "updated_at"])
    log(memo, MemorandumEvent.Kind.RESUBMITTED, actor=actor, employee=employee, comment=comment)
    _announce(memo)
    return memo


@transaction.atomic
def decide(memo, employee, *, approve, comment="", actor=None):
    """The approver ends it.

    The only transition that closes a memorandum. After this `is_locked` is
    true and every write path refuses — including the content, which was
    editable right up to this moment.
    """
    _require_holder(memo, employee)
    if memo.stage != Memorandum.Stage.APPROVE:
        raise MemorandumError("Only the approver can decide, and only once it reaches them.")

    memo.status = Memorandum.Status.APPROVED if approve else Memorandum.Status.REJECTED
    memo.stage = Memorandum.Stage.CLOSED
    memo.current_holder = None
    memo.decided_at = timezone.now()
    memo.updated_by = actor
    memo.save(
        update_fields=["status", "stage", "current_holder", "decided_at", "updated_by", "updated_at"]
    )
    log(
        memo,
        MemorandumEvent.Kind.APPROVED if approve else MemorandumEvent.Kind.REJECTED,
        actor=actor, employee=employee, comment=comment,
    )
    _announce(memo, closed=True)
    return memo


# ── Telling people ───────────────────────────────────────────────────────


def tell_mentioned(memo, event, mentioned, *, actor=None):
    """Tell the people a comment named that it named them.

    **The reason mentioning exists at all.** A memorandum reaches the chain and
    nobody else, and the chain is chosen for who must *decide*, not for who
    knows the answer. The engineer who surveyed the alignment, the accountant
    who set the rate — neither belongs in the approval path, and before this
    the only way to ask them anything was to leave the product and send an
    email, which is where the record stops.

    The notice carries the comment itself rather than "you were mentioned":
    somebody named in one paragraph should not have to open a workflow tool to
    find out whether it needed them.

    Guarded like every other notice here — the comment is the record and it is
    already written; a mail server being down must not undo it.
    """
    from notifications.services import notify

    author = _label(getattr(event, "actor_employee", None)) or (
        actor.get_username() if actor else "Somebody"
    )
    excerpt = (event.comment or "").strip()
    if len(excerpt) > 200:
        excerpt = excerpt[:197] + "…"

    for employee in mentioned:
        user = getattr(employee, "user", None)
        # Naming yourself is not a notification.
        if user is None or (actor is not None and user.pk == getattr(actor, "pk", None)):
            continue
        try:
            notify(
                user,
                "memorandum_mentioned",
                f"{author} mentioned you on memorandum {memo.memo_id or 'draft'} — "
                f"{memo.subject}: “{excerpt}”",
                email_subject=f"You were mentioned on {memo.subject}",
            )
        except Exception:  # noqa: BLE001 — see the docstring
            continue


def _announce(memo, closed=False):
    """Tell whoever it has landed on, and the initiator when it is over.

    A memo sitting on somebody's desk that they do not know about is the whole
    failure mode of a paper system, and the one thing this module is supposed
    to fix. Guarded: a notification that fails must not undo a transition that
    has already been recorded.
    """
    from notifications.services import notify

    try:
        if closed:
            verdict = "approved" if memo.status == Memorandum.Status.APPROVED else "rejected"
            notify(
                memo.initiator.user,
                f"memorandum_{verdict}",
                f"Your memorandum {memo.memo_id} — {memo.subject} — was {verdict}.",
                email_subject=f"Memorandum {verdict}: {memo.subject}",
            )
            return
        holder = memo.current_holder
        if holder is None:
            return
        if holder.pk == memo.initiator_id:
            message = f"Memorandum {memo.memo_id} — {memo.subject} — has been sent back to you."
            subject = "A memorandum has been sent back to you"
        else:
            message = f"Memorandum {memo.memo_id} — {memo.subject} — is waiting for you."
            subject = "A memorandum needs your attention"
        notify(holder.user, "memorandum_pending", message, email_subject=subject)
    except Exception:  # noqa: BLE001 — the transition is the record; the notice is not
        import logging

        logging.getLogger(__name__).exception(
            "Could not announce memorandum %s", memo.pk
        )
