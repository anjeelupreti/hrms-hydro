"""Reminders that fire before the thing happens, on rules somebody configured.

A reminder that fires *on the day* is an announcement, not a reminder: "today
is Dashain, enjoy it" is nothing anybody can plan around. Lead days are the
whole point — as is having something watch `probation_end_date` and
`passport_expiry` at all.

Two properties carry the weight here. **Sent once**, because the job runs daily
and must be safe to re-run — a reminder that arrives every morning until the
date is a reminder people filter. And **the template cannot evaluate anything**,
because the text is typed by a customer and `str.format` is an escape hatch.
"""

from datetime import date, timedelta

import pytest
from django.core import mail

from notifications.models import Holiday, ReminderLog, ReminderRule
from notifications.reminders import kinds, render, run_reminders, seed_default_rules

pytestmark = pytest.mark.django_db


@pytest.fixture
def rules(company):
    seed_default_rules()
    yield


def _rule(kind, *, lead_days, enabled=True, subject=None, body=None):
    rule = ReminderRule.objects.get(kind=kind)
    rule.lead_days = lead_days
    rule.is_enabled = enabled
    if subject is not None:
        rule.subject = subject
    if body is not None:
        rule.body = body
    rule.save()
    return rule


# ── The substitution cannot be used to evaluate anything ─────────────────


def test_a_placeholder_is_replaced_by_its_value():
    assert render("Hi {name}, it is {days} days", {"name": "Sita", "days": 7}) == (
        "Hi Sita, it is 7 days"
    )


def test_an_unknown_placeholder_is_left_visible():
    """A typo should show as a typo in the preview, not as an eerie gap
    somebody has to work backwards from."""
    assert render("Hi {nmae}", {"name": "Sita"}) == "Hi {nmae}"


def test_a_template_cannot_reach_through_an_attribute():
    """`str.format` would evaluate this. `{x.__class__}` is a real escape from
    it, and this text is typed by a customer."""
    out = render("{name.__class__}", {"name": "Sita"})

    assert out == "{name.__class__}"
    assert "class" not in out.replace("__class__", "")


def test_a_template_cannot_index_or_call():
    assert render("{a[0]} {b()}", {"a": [1], "b": len}) == "{a[0]} {b()}"


# ── Firing on the configured lead time ───────────────────────────────────


def test_a_probation_ending_is_warned_about_in_advance(company, payroll_setup, rules):
    """The gap this closes. `probation_end_date` has been stored since Phase 3
    and nothing has ever read it — probation lapsed silently and
    `is_on_probation()` simply started returning False."""
    emp = payroll_setup["emp"]
    emp.probation_end_date = date.today() + timedelta(days=7)
    emp.save(update_fields=["probation_end_date"])
    _rule("probation_ending", lead_days=[7])
    mail.outbox.clear()

    summary = run_reminders()

    assert summary["sent"] >= 1
    assert any("Probation ending" in m.subject for m in mail.outbox)


def test_nothing_fires_on_the_wrong_day(company, payroll_setup, rules):
    """A 7-day rule fires 7 days before, not 6 and not 8."""
    emp = payroll_setup["emp"]
    emp.probation_end_date = date.today() + timedelta(days=6)
    emp.save(update_fields=["probation_end_date"])
    _rule("probation_ending", lead_days=[7])
    mail.outbox.clear()

    summary = run_reminders()

    assert summary["sent"] == 0
    assert mail.outbox == []


def test_two_lead_times_are_two_separate_warnings(company, payroll_setup, rules):
    """One warning is rarely enough and rarely the right distance. A month out
    there is still time to arrange a conversation; a week out there is not."""
    emp = payroll_setup["emp"]
    _rule("probation_ending", lead_days=[30, 7])

    emp.probation_end_date = date.today() + timedelta(days=30)
    emp.save(update_fields=["probation_end_date"])
    first = run_reminders()["sent"]

    emp.probation_end_date = date.today() + timedelta(days=7)
    emp.save(update_fields=["probation_end_date"])
    second = run_reminders()["sent"]

    assert first >= 1
    assert second >= 1


# ── Sent once, whatever the schedule does ────────────────────────────────


def test_running_twice_does_not_remind_twice(company, payroll_setup, rules):
    """The job runs daily and is safe to re-run. Without this, a probation a
    month away generates thirty identical emails."""
    emp = payroll_setup["emp"]
    emp.probation_end_date = date.today() + timedelta(days=7)
    emp.save(update_fields=["probation_end_date"])
    _rule("probation_ending", lead_days=[7])

    run_reminders()
    mail.outbox.clear()
    again = run_reminders()

    assert again["sent"] == 0
    assert again["already_sent"] >= 1
    assert mail.outbox == []


def test_the_same_event_at_a_different_lead_is_a_different_reminder(
    company, payroll_setup, rules
):
    """The 30-day and 7-day notices about one probation are two deliveries, not
    a duplicate of each other."""
    emp = payroll_setup["emp"]
    _rule("probation_ending", lead_days=[30, 7])
    emp.probation_end_date = date.today() + timedelta(days=30)
    emp.save(update_fields=["probation_end_date"])
    run_reminders()

    # Three weeks pass; the same probation is now a week away.
    run_reminders(on_date=date.today() + timedelta(days=23))

    leads = set(
        ReminderLog.objects.filter(rule__kind="probation_ending").values_list(
            "lead_days", flat=True
        )
    )

    assert leads == {30, 7}


# ── The customer's switches actually switch ──────────────────────────────


def test_a_disabled_rule_sends_nothing(company, payroll_setup, rules):
    emp = payroll_setup["emp"]
    emp.probation_end_date = date.today() + timedelta(days=7)
    emp.save(update_fields=["probation_end_date"])
    _rule("probation_ending", lead_days=[7], enabled=False)
    mail.outbox.clear()

    summary = run_reminders()

    assert summary["sent"] == 0
    assert mail.outbox == []


def test_the_customers_own_wording_is_what_goes_out(company, payroll_setup, rules):
    """The wording of a message to their own staff is not our business."""
    emp = payroll_setup["emp"]
    emp.probation_end_date = date.today() + timedelta(days=7)
    emp.save(update_fields=["probation_end_date"])
    _rule(
        "probation_ending",
        lead_days=[7],
        subject="Review due: {employee_name}",
        body="Please book a review. {days} days left.",
    )
    mail.outbox.clear()

    run_reminders()

    assert any(m.subject.startswith("Review due:") for m in mail.outbox)


def test_a_nonsense_lead_time_costs_only_itself(company, payroll_setup, rules):
    """`lead_days` is a JSONField, so a hand-edited fixture or an older client
    can put anything in it. A bad entry should cost that one reminder, not the
    nightly run."""
    emp = payroll_setup["emp"]
    emp.probation_end_date = date.today() + timedelta(days=7)
    emp.save(update_fields=["probation_end_date"])
    rule = _rule("probation_ending", lead_days=["seven", None, -3, 7])

    assert rule.offsets() == [7]
    summary = run_reminders()

    assert summary["sent"] >= 1


def test_a_rule_naming_an_unknown_kind_is_skipped(company, payroll_setup, rules):
    """A kind withdrawn, or a database restored from a newer build. One stale
    row must not stop every other reminder going out."""
    emp = payroll_setup["emp"]
    emp.probation_end_date = date.today() + timedelta(days=7)
    emp.save(update_fields=["probation_end_date"])
    _rule("probation_ending", lead_days=[7])
    ReminderRule.objects.create(kind="a_kind_that_went_away", lead_days=[1])

    summary = run_reminders()

    assert summary["sent"] >= 1


# ── The other kinds resolve ──────────────────────────────────────────────


def test_a_holiday_is_announced_in_advance(company, payroll_setup, rules):
    """The existing task says "today is Dashain, enjoy it" on the morning of.
    This is the one people can plan around."""
    Holiday.objects.create(name="Dashain", date=date.today() + timedelta(days=7))
    _rule("holiday_upcoming", lead_days=[7])
    mail.outbox.clear()

    summary = run_reminders()

    assert summary["sent"] >= 1
    assert any("Dashain" in m.subject for m in mail.outbox)


def test_a_passport_expiry_is_warned_about(company, payroll_setup, rules):
    """Stored since the statutory fields were added and never once read."""
    emp = payroll_setup["emp"]
    emp.passport_expiry = date.today() + timedelta(days=90)
    emp.save(update_fields=["passport_expiry"])
    _rule("passport_expiring", lead_days=[90])
    mail.outbox.clear()

    summary = run_reminders()

    assert summary["sent"] >= 1


# ── Preview, so a rule can be seen before it is switched on ──────────────


def test_a_dry_run_renders_without_sending(company, payroll_setup, rules):
    """Somebody should see the actual message against their actual data before
    turning a rule on, not after."""
    emp = payroll_setup["emp"]
    emp.probation_end_date = date.today() + timedelta(days=7)
    emp.save(update_fields=["probation_end_date"])
    _rule("probation_ending", lead_days=[7])
    mail.outbox.clear()

    result = run_reminders(dry_run=True)

    assert result["previews"]
    assert mail.outbox == []
    assert ReminderLog.objects.count() == 0


# ── Seeding ──────────────────────────────────────────────────────────────


def test_seeding_gives_one_rule_per_kind(company):
    seed_default_rules()

    assert ReminderRule.objects.count() == len(kinds("company"))


def test_seeding_twice_does_not_duplicate(company):
    seed_default_rules()
    seed_default_rules()

    assert ReminderRule.objects.count() == len(kinds("company"))


def test_most_kinds_arrive_switched_off(company):
    """A product that starts mailing everybody about everything on day one gets
    its notifications turned off wholesale, including the ones that mattered."""
    seed_default_rules()
    enabled = set(
        ReminderRule.objects.filter(is_enabled=True).values_list("kind", flat=True)
    )

    assert enabled == {"probation_ending", "holiday_upcoming"}


def test_every_registered_kind_declares_its_variables():
    """The settings screen lists these so somebody knows what they may type. A
    kind with none is one nobody can write a message for."""
    for kind in kinds("company"):
        assert kind.variables, f"{kind.key} declares no template variables"
        assert kind.default_subject and kind.default_body


# ── The API the settings screen drives ───────────────────────────────────

RULES_URL = "/api/v1/notifications/reminder-rules/"


def test_the_rules_list_carries_what_a_screen_needs(company, admin_client, rules):
    """Label, description and available variables come from the registry, so a
    screen never holds a second copy of what a kind means."""
    response = admin_client.get(RULES_URL)

    assert response.status_code == 200
    row = next(r for r in response.data["results"] if r["kind"] == "probation_ending")
    assert row["label"] == "Probation ending"
    assert row["description"]
    assert "employee_name" in row["variables"]


def test_hr_can_change_the_wording_and_the_timing(company, admin_client, rules):
    rule = ReminderRule.objects.get(kind="probation_ending")

    response = admin_client.patch(
        f"{RULES_URL}{rule.id}/",
        {"lead_days": [14, 3], "subject": "Review {employee_name}"},
        format="json",
    )

    assert response.status_code == 200
    assert response.data["lead_days"] == [14, 3]


def test_an_employee_cannot_change_the_rules(company, employee_client, rules):
    """Readable by everyone — a reminder rule describes what the company will
    send *you*. Editable by HR only."""
    rule = ReminderRule.objects.get(kind="probation_ending")

    assert employee_client.get(RULES_URL).status_code == 200
    assert employee_client.patch(
        f"{RULES_URL}{rule.id}/", {"is_enabled": False}, format="json"
    ).status_code == 403


def test_a_placeholder_the_kind_does_not_offer_is_refused(company, admin_client, rules):
    """Caught on save rather than at send time. An unknown name renders as
    itself, so `{employe_name}` would go out in a real email to real staff and
    nobody would know until somebody received it."""
    rule = ReminderRule.objects.get(kind="probation_ending")

    response = admin_client.patch(
        f"{RULES_URL}{rule.id}/", {"body": "Hi {salary}"}, format="json"
    )

    assert response.status_code == 400
    assert "salary" in str(response.data)


def test_a_lead_time_after_the_event_is_refused(company, admin_client, rules):
    rule = ReminderRule.objects.get(kind="probation_ending")

    response = admin_client.patch(
        f"{RULES_URL}{rule.id}/", {"lead_days": [-5]}, format="json"
    )

    assert response.status_code == 400


def test_an_empty_lead_list_is_refused(company, admin_client, rules):
    """A rule that is on and fires never is a rule somebody thinks is working."""
    rule = ReminderRule.objects.get(kind="probation_ending")

    response = admin_client.patch(f"{RULES_URL}{rule.id}/", {"lead_days": []}, format="json")

    assert response.status_code == 400


def test_the_kind_cannot_be_repointed(company, admin_client, rules):
    """Editable, it would let somebody aim a configured message at a different
    query and quietly change who receives it."""
    rule = ReminderRule.objects.get(kind="probation_ending")

    admin_client.patch(f"{RULES_URL}{rule.id}/", {"kind": "task_due"}, format="json")
    rule.refresh_from_db()

    assert rule.kind == "probation_ending"


def test_preview_renders_without_sending(company, admin_client, payroll_setup, rules):
    """The first thing anybody wants to know about a template is whether it
    reads properly with a real name in it — not tomorrow, now."""
    emp = payroll_setup["emp"]
    emp.probation_end_date = date.today() + timedelta(days=7)
    emp.save(update_fields=["probation_end_date"])
    _rule("probation_ending", lead_days=[7])
    mail.outbox.clear()

    response = admin_client.get(f"{RULES_URL}preview/")

    assert response.status_code == 200
    assert len(response.data) >= 1
    assert mail.outbox == []


# ── The same-day greeting and the configurable rule ──────────────────────


def test_the_same_day_greeting_still_fires_by_default(company, payroll_setup, rules):
    """The default leads are [7]. A company who has not touched the rule must
    keep getting the greeting they get today — a mechanism replacing a
    behaviour should not remove it from everybody who never asked."""
    from notifications.tasks import send_holiday_reminders

    Holiday.objects.create(name="Dashain", date=date.today())
    mail.outbox.clear()

    result = send_holiday_reminders()

    assert "notified" in result
    assert any("Dashain" in m.subject for m in mail.outbox)


def test_the_greeting_stands_down_when_the_rule_covers_today(company, payroll_setup, rules):
    """A company who adds 0 to the rule is asking for a message on the day, and
    would otherwise have received two. Theirs wins — they chose the wording."""
    from notifications.tasks import send_holiday_reminders

    Holiday.objects.create(name="Dashain", date=date.today())
    _rule("holiday_upcoming", lead_days=[7, 0])
    mail.outbox.clear()

    result = send_holiday_reminders()

    assert "covered by the configured reminder" in result
    assert mail.outbox == []


def test_a_disabled_rule_leaves_the_greeting_alone(company, payroll_setup, rules):
    """Switching the reminder off must not also silence the greeting — that
    would be one switch quietly turning off two things."""
    from notifications.tasks import send_holiday_reminders

    Holiday.objects.create(name="Dashain", date=date.today())
    _rule("holiday_upcoming", lead_days=[0], enabled=False)
    mail.outbox.clear()

    result = send_holiday_reminders()

    assert "notified" in result
