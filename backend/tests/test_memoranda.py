"""The memorandum chain: forwards, backwards, and the door that shuts.

Three properties carry the module, and every test here belongs to one.

**The chain is ordered and the cursor moves both ways.** A memorandum climbs it,
can be sent back to anybody who has already seen it, and then climbs it again
from there. That loop has no state to unwind, which is what lets it run any
number of times.

**Who may change what, and when.** After submission only the text moves; the
chain ahead of the cursor may be redrawn and the part behind it may not.

**After a decision, nothing.** A memorandum is evidence.
"""

from datetime import date, timedelta

import pytest

from companies.models import Company
from employees.models import Employee
from memoranda.models import Memorandum, MemorandumAction, MemorandumEvent
from memoranda.workflow import (
    MemorandumError,
    decide,
    has_ever_acted,
    eligible_return_targets,
    proceed,
    resubmit,
    send_back,
    set_approver,
    set_chain,
    submit,
)

pytestmark = pytest.mark.django_db

LIST = "/api/v1/memoranda/memoranda/"
ACTIONS = "/api/v1/memoranda/actions/"


# ── Cast ─────────────────────────────────────────────────────────────────


@pytest.fixture
def recommend(db):
    return MemorandumAction.objects.create(
        name="Recommended", code="REC", effect=MemorandumAction.Effect.PROCEED, order=1
    )


@pytest.fixture
def send_back_action(db):
    return MemorandumAction.objects.create(
        name="Returned for correction", code="RET",
        effect=MemorandumAction.Effect.RETURN, order=9,
    )


def _person(username, code, company, **extra):
    from django.contrib.auth import get_user_model

    User = get_user_model()
    user = User.objects.create_user(
        username=username, email=f"{username}@example.com", password="x", **extra
    )
    return Employee.objects.create(
        user=user, employee_code=code, date_joined=date(2024, 1, 1), primary_company=company
    )


@pytest.fixture
def cast(db, company):
    return {
        "initiator": _person("m_init", "M-INIT", company),
        "a": _person("m_a", "M-A", company),
        "b": _person("m_b", "M-B", company),
        "c": _person("m_c", "M-C", company),
        "approver": _person("m_appr", "M-APPR", company),
    }


@pytest.fixture
def memo(db, company, cast):
    m = Memorandum.objects.create(
        company=company,
        memo_date=date.today(),
        subject="Sanjen tailrace variation",
        content="<p>Proposed change to the tailrace alignment.</p>",
        initiator=cast["initiator"],
        approver=cast["approver"],
    )
    set_chain(m, [cast["a"].pk, cast["b"].pk, cast["c"].pk])
    return m


def _client(employee):
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_authenticate(user=employee.user)
    return client


# ── Submitting ───────────────────────────────────────────────────────────


def test_submitting_mints_the_id_and_lands_on_the_first_recommender(memo, cast, company):
    submit(memo)

    memo.refresh_from_db()
    assert memo.memo_id == f"{date.today():%Y-%m-%d}-{company.code}-0001"
    assert memo.status == Memorandum.Status.IN_PROGRESS
    assert memo.current_holder == cast["a"]
    assert memo.current_index == 0


def test_a_backdated_memorandum_is_refused(memo):
    """A memorandum is dated the day it is raised. One dated last week and
    submitted now is either a mistake or a register being rewritten."""
    memo.memo_date = date.today() - timedelta(days=3)
    memo.save()

    with pytest.raises(MemorandumError, match="dated the day it is submitted"):
        submit(memo)


def test_serials_run_per_company_and_do_not_collide(company, second_company, cast):
    first = Memorandum.objects.create(
        company=company, memo_date=date.today(), subject="One",
        content="<p>x</p>", initiator=cast["initiator"], approver=cast["approver"],
    )
    second = Memorandum.objects.create(
        company=company, memo_date=date.today(), subject="Two",
        content="<p>x</p>", initiator=cast["initiator"], approver=cast["approver"],
    )
    other = Memorandum.objects.create(
        company=second_company, memo_date=date.today(), subject="Three",
        content="<p>x</p>", initiator=cast["initiator"], approver=cast["approver"],
    )
    for m in (first, second, other):
        submit(m)

    assert first.serial_number == 1
    assert second.serial_number == 2
    assert other.serial_number == 1, "each company keeps its own register"
    assert second_company.code in other.memo_id


def test_an_abandoned_draft_consumes_no_number(company, cast):
    """A gap in the register is unexplainable a year later, so the number is
    minted at submission rather than at creation."""
    Memorandum.objects.create(
        company=company, memo_date=date.today(), subject="Never sent",
        content="<p>x</p>", initiator=cast["initiator"],
    )
    real = Memorandum.objects.create(
        company=company, memo_date=date.today(), subject="Sent",
        content="<p>x</p>", initiator=cast["initiator"], approver=cast["approver"],
    )
    submit(real)

    assert real.serial_number == 1


def test_a_memorandum_with_nobody_to_send_it_to_is_refused(company, cast):
    m = Memorandum.objects.create(
        company=company, memo_date=date.today(), subject="Into the void",
        content="<p>x</p>", initiator=cast["initiator"],
    )

    with pytest.raises(MemorandumError, match="at least one recommender"):
        submit(m)


# ── Forwards ─────────────────────────────────────────────────────────────


def test_it_climbs_the_chain_in_the_order_the_initiator_drew(memo, cast, recommend):
    submit(memo)

    proceed(memo, cast["a"], action=recommend, comment="Alignment is sound.")
    memo.refresh_from_db()
    assert memo.current_holder == cast["b"]

    proceed(memo, cast["b"], action=recommend)
    memo.refresh_from_db()
    assert memo.current_holder == cast["c"]

    proceed(memo, cast["c"], action=recommend)
    memo.refresh_from_db()
    assert memo.stage == Memorandum.Stage.APPROVE
    assert memo.current_holder == cast["approver"]


def test_somebody_who_is_not_holding_it_cannot_move_it(memo, cast, recommend):
    submit(memo)

    with pytest.raises(MemorandumError, match="not with you"):
        proceed(memo, cast["c"], action=recommend)


def test_a_return_word_cannot_be_used_to_send_it_on(memo, cast, send_back_action):
    """The machinery reads `effect` and never a name, so a vocabulary word can
    never do the opposite of what it says."""
    submit(memo)

    with pytest.raises(MemorandumError, match="Choose what to record"):
        proceed(memo, cast["a"], action=send_back_action)


def test_the_approver_decides_rather_than_passing_it_on(memo, cast, recommend):
    submit(memo)
    for person in ("a", "b", "c"):
        proceed(memo, cast[person], action=recommend)

    with pytest.raises(MemorandumError, match="approver decides"):
        proceed(memo, cast["approver"], action=recommend)


# ── Backwards ────────────────────────────────────────────────────────────


def test_it_can_be_sent_back_to_the_initiator_and_climbs_again(memo, cast, recommend, send_back_action):
    submit(memo)
    proceed(memo, cast["a"], action=recommend)

    send_back(memo, cast["b"], to=cast["initiator"], action=send_back_action,
              comment="Third paragraph is wrong.")
    memo.refresh_from_db()
    assert memo.current_holder == cast["initiator"]
    assert memo.status == Memorandum.Status.IN_PROGRESS, "returning is not rejection"

    resubmit(memo, cast["initiator"], comment="Corrected.")
    memo.refresh_from_db()
    assert memo.current_holder == cast["a"], "it starts again from the first recommender"


def test_it_can_be_sent_back_to_a_middle_step_and_resumes_from_there(
    memo, cast, recommend, send_back_action
):
    """"It restarts from the point it was returned to" — mechanically, the
    cursor moves back and then forward again through the same people."""
    submit(memo)
    proceed(memo, cast["a"], action=recommend)
    proceed(memo, cast["b"], action=recommend)

    send_back(memo, cast["c"], to=cast["b"], action=send_back_action, comment="Check the figures.")
    memo.refresh_from_db()
    assert memo.current_holder == cast["b"]

    proceed(memo, cast["b"], action=recommend, comment="Checked.")
    memo.refresh_from_db()
    assert memo.current_holder == cast["c"], "forward through the same chain"


def test_it_cannot_be_sent_forward_disguised_as_a_return(memo, cast, recommend):
    """Never to somebody ahead of the cursor — the log would then read as
    though the chain ran backwards."""
    submit(memo)

    with pytest.raises(MemorandumError, match="already handled it"):
        send_back(memo, cast["a"], to=cast["c"])


def test_the_return_targets_are_the_initiator_and_whoever_has_seen_it(memo, cast, recommend):
    submit(memo)
    proceed(memo, cast["a"], action=recommend)
    proceed(memo, cast["b"], action=recommend)
    memo.refresh_from_db()

    targets = {e.pk for e in eligible_return_targets(memo)}

    assert targets == {cast["initiator"].pk, cast["a"].pk, cast["b"].pk}


def test_the_loop_can_run_more_than_once(memo, cast, recommend, send_back_action):
    """Until approved or rejected. There is no state to get stuck in."""
    submit(memo)
    for _ in range(3):
        send_back(memo, cast["a"], to=cast["initiator"], action=send_back_action)
        memo.refresh_from_db()
        resubmit(memo, cast["initiator"])
        memo.refresh_from_db()

    assert memo.current_holder == cast["a"]
    assert memo.status == Memorandum.Status.IN_PROGRESS
    assert memo.events.filter(kind=MemorandumEvent.Kind.RETURNED).count() == 3


def test_only_the_initiator_sends_a_returned_memorandum_forward_again(
    memo, cast, recommend, send_back_action
):
    submit(memo)
    proceed(memo, cast["a"], action=recommend)
    send_back(memo, cast["b"], to=cast["a"], action=send_back_action)
    memo.refresh_from_db()

    with pytest.raises(MemorandumError, match="Only the initiator"):
        resubmit(memo, cast["a"])


# ── Editing while in flight ──────────────────────────────────────────────


def test_a_recommender_who_has_acted_cannot_be_removed(memo, cast, recommend):
    """Their comment is part of the record, and the chain is what it is
    attached to."""
    submit(memo)
    proceed(memo, cast["a"], action=recommend)

    with pytest.raises(MemorandumError, match="already handled"):
        set_chain(memo, [cast["b"].pk, cast["c"].pk])


def test_the_person_holding_it_cannot_be_removed(memo, cast):
    submit(memo)

    with pytest.raises(MemorandumError, match="holding this memorandum right now"):
        set_chain(memo, [cast["b"].pk, cast["c"].pk])


def test_the_tail_of_the_chain_can_still_be_redrawn(memo, cast, recommend, second_company):
    """The normal case: it comes back saying "finance should see this too"."""
    submit(memo)
    proceed(memo, cast["a"], action=recommend)
    memo.refresh_from_db()
    extra = _person("m_fin", "M-FIN", second_company)

    set_chain(memo, [cast["a"].pk, cast["b"].pk, extra.pk])

    memo.refresh_from_db()
    assert [r.employee_id for r in memo.chain] == [cast["a"].pk, cast["b"].pk, extra.pk]
    assert memo.current_holder == cast["b"], "the cursor stays on whoever is holding it"


def test_the_approver_can_be_changed_until_it_reaches_them(memo, cast, recommend, second_company):
    other = _person("m_appr2", "M-APPR2", second_company)
    submit(memo)

    set_approver(memo, other)
    memo.refresh_from_db()
    assert memo.approver == other

    for person in ("a", "b", "c"):
        proceed(memo, cast[person], action=recommend)
    memo.refresh_from_db()

    with pytest.raises(MemorandumError, match="already with the approver"):
        set_approver(memo, cast["approver"])


def test_the_initiator_cannot_be_their_own_recommender(memo, cast):
    with pytest.raises(MemorandumError, match="initiator cannot also be"):
        set_chain(memo, [cast["initiator"].pk])


# ── The door that shuts ──────────────────────────────────────────────────


def test_approval_closes_it_to_everybody(memo, cast, recommend):
    submit(memo)
    for person in ("a", "b", "c"):
        proceed(memo, cast[person], action=recommend)

    decide(memo, cast["approver"], approve=True, comment="Approved.")

    memo.refresh_from_db()
    assert memo.status == Memorandum.Status.APPROVED
    assert memo.is_locked
    assert memo.current_holder is None

    with pytest.raises(MemorandumError, match="has been decided"):
        set_chain(memo, [cast["a"].pk])


def test_an_approved_memorandum_cannot_be_edited_over_the_wire(memo, cast, recommend):
    """Not a single dot. Enforced on the write path, not merely hidden."""
    submit(memo)
    for person in ("a", "b", "c"):
        proceed(memo, cast[person], action=recommend)
    decide(memo, cast["approver"], approve=True)

    response = _client(cast["initiator"]).patch(
        f"{LIST}{memo.pk}/", {"content": "<p>Quietly different.</p>"}, format="json"
    )

    assert response.status_code == 400
    memo.refresh_from_db()
    assert "Quietly different" not in memo.content


def test_rejection_closes_it_the_same_way(memo, cast, recommend):
    submit(memo)
    for person in ("a", "b", "c"):
        proceed(memo, cast[person], action=recommend)

    decide(memo, cast["approver"], approve=False, comment="Not this year.")

    memo.refresh_from_db()
    assert memo.status == Memorandum.Status.REJECTED
    assert memo.is_locked


# ── Over the wire ────────────────────────────────────────────────────────


def test_the_content_cannot_be_rewritten_while_somebody_else_holds_it(memo, cast):
    """This used to assert the opposite, and the opposite was wrong.

    The text stayed editable by the initiator for as long as the memorandum was
    undecided — including while it sat on a recommender's desk. So somebody
    could be reading paragraph three, and approving it, while it was being
    replaced underneath them: what they signed was not what they read. The
    correction happens when it comes *back*, which is what a return is for —
    see `test_sent_back_to_the_initiator_returns_the_pen`.
    """
    submit(memo)

    response = _client(cast["initiator"]).patch(
        f"{LIST}{memo.pk}/", {"content": "<p>Corrected third paragraph.</p>"}, format="json"
    )

    assert response.status_code == 403, response.data
    memo.refresh_from_db()
    assert "Corrected" not in memo.content


def test_the_subject_and_date_are_fixed_once_submitted(memo, cast):
    """The chain has been reading them; changing them beneath their comments
    would make every one a comment on a different document."""
    submit(memo)

    response = _client(cast["initiator"]).patch(
        f"{LIST}{memo.pk}/", {"subject": "Something else entirely"}, format="json"
    )

    assert response.status_code == 400
    assert "only the content" in str(response.data).lower()


def test_a_submitted_memorandum_cannot_be_deleted(memo, cast):
    submit(memo)

    response = _client(cast["initiator"]).delete(f"{LIST}{memo.pk}/")

    assert response.status_code == 409
    assert Memorandum.objects.filter(pk=memo.pk).exists()


def test_somebody_outside_the_chain_cannot_see_it(memo, cast, recommend, second_company):
    """A memorandum is a private note between the people named on it."""
    submit(memo)
    outsider = _person("m_out", "M-OUT", second_company)

    response = _client(outsider).get(f"{LIST}{memo.pk}/")

    assert response.status_code == 404


def test_my_desk_separates_what_needs_me_from_what_i_have_handled(memo, cast, recommend):
    submit(memo)

    waiting = _client(cast["a"]).get(f"{LIST}my-desk/")
    assert [m["id"] for m in waiting.data["awaiting_me"]] == [memo.pk]
    assert waiting.data["handled"] == []

    proceed(memo, cast["a"], action=recommend)

    after = _client(cast["a"]).get(f"{LIST}my-desk/")
    assert after.data["awaiting_me"] == []
    assert [m["id"] for m in after.data["handled"]] == [memo.pk]


def test_the_initiator_sees_their_own_under_mine(memo, cast, recommend):
    submit(memo)

    response = _client(cast["initiator"]).get(f"{LIST}my-desk/")

    assert [m["id"] for m in response.data["mine"]] == [memo.pk]


def test_the_log_carries_every_comment_in_order(memo, cast, recommend, send_back_action):
    submit(memo)
    proceed(memo, cast["a"], action=recommend, comment="Alignment sound.")
    send_back(memo, cast["b"], to=cast["initiator"], action=send_back_action, comment="Figures wrong.")
    resubmit(memo, cast["initiator"], comment="Figures corrected.")

    response = _client(cast["initiator"]).get(f"{LIST}{memo.pk}/")

    comments = [e["comment"] for e in response.data["events"] if e["comment"]]
    assert comments == ["Alignment sound.", "Figures wrong.", "Figures corrected."]
    # In order, and the return names who it went back to.
    kinds = [e["kind"] for e in response.data["events"]]
    assert kinds == ["submitted", "proceeded", "returned", "resubmitted"]
    returned = next(e for e in response.data["events"] if e["kind"] == "returned")
    assert returned["returned_to_name"] is not None


def test_raising_one_through_the_api_logs_that_it_was_created(cast, company):
    """The fixtures above build the row directly; this is the path a person
    actually takes, and it is where the opening line of the history comes
    from."""
    response = _client(cast["initiator"]).post(
        LIST,
        {
            "company": company.pk,
            "memo_date": str(date.today()),
            "subject": "Raised properly",
            "content": "<p>Body.</p>",
            "approver": cast["approver"].pk,
            "recommender_ids": [cast["a"].pk],
        },
        format="json",
    )

    assert response.status_code == 201, response.data
    assert response.data["status"] == "draft"
    assert response.data["memo_id"] is None, "no number until it is submitted"
    assert [e["kind"] for e in response.data["events"]] == ["created"]
    assert [r["employee"] for r in response.data["recommenders"]] == [cast["a"].pk]


def test_the_word_used_survives_the_action_being_renamed(memo, cast, recommend):
    """The log has to keep saying what it said on the day."""
    submit(memo)
    proceed(memo, cast["a"], action=recommend)

    recommend.name = "Endorsed"
    recommend.save()

    entry = memo.events.filter(kind=MemorandumEvent.Kind.PROCEEDED).first()
    assert entry.action_label == "Recommended"


# ── The vocabulary ───────────────────────────────────────────────────────


def test_everybody_reads_the_action_list_and_only_an_admin_writes_it(
    employee_client, admin_client, recommend
):
    """A dropdown whose meaning the reader cannot see is worse than no dropdown."""
    assert employee_client.get(ACTIONS).status_code == 200

    refused = employee_client.post(
        ACTIONS, {"name": "Invented", "code": "INV", "effect": "proceed"}, format="json"
    )
    assert refused.status_code == 403

    allowed = admin_client.post(
        ACTIONS, {"name": "Verified", "code": "VER", "effect": "proceed"}, format="json"
    )
    assert allowed.status_code == 201, allowed.data


def test_an_action_that_has_been_used_cannot_be_deleted(admin_client, memo, cast, recommend):
    submit(memo)
    proceed(memo, cast["a"], action=recommend)

    response = admin_client.delete(f"{ACTIONS}{recommend.pk}/")

    assert response.status_code == 409
    assert response.data["code"] == "action_in_use"


# ── The content is rendered into other people's pages ────────────────────


def test_a_script_in_the_content_is_stripped_before_it_is_stored(memo, cast):
    """A memorandum is read by exactly the senior people whose sessions are
    worth stealing, which makes it the highest-value place to put one."""
    response = _client(cast["initiator"]).patch(
        f"{LIST}{memo.pk}/",
        {"content": "<p>Fine.</p><script>fetch('/evil')</script><p onclick='x()'>Also fine.</p>"},
        format="json",
    )

    assert response.status_code == 200, response.data
    memo.refresh_from_db()
    assert "<script" not in memo.content
    assert "onclick" not in memo.content
    assert "fetch('/evil')" not in memo.content
    assert "Fine." in memo.content and "Also fine." in memo.content


def test_ordinary_formatting_survives(memo, cast):
    html = '<p style="text-align: center"><strong>Bold</strong> and <em>italic</em></p><ul><li>One</li></ul>'
    response = _client(cast["initiator"]).patch(f"{LIST}{memo.pk}/", {"content": html}, format="json")

    assert response.status_code == 200
    memo.refresh_from_db()
    assert "<strong>" in memo.content
    assert "<em>" in memo.content
    assert "<li>" in memo.content
    assert "text-align: center" in memo.content


def test_a_javascript_link_is_dropped_and_the_text_kept(memo, cast):
    response = _client(cast["initiator"]).patch(
        f"{LIST}{memo.pk}/",
        {"content": '<p><a href="javascript:alert(1)">Click</a></p>'},
        format="json",
    )

    memo.refresh_from_db()
    assert "javascript:" not in memo.content
    assert "Click" in memo.content


# ── Refusals reach the screen ────────────────────────────────────────────


def test_removing_an_acted_recommender_over_the_api_is_a_400_not_a_crash(memo, cast, recommend):
    """🔒 The rule the owner named, on the path the browser actually takes.

    `set_chain` refuses to drop somebody who has already signed — that is
    tested directly above. What was not tested is *where* the refusal is
    raised from: a PATCH reaches `set_chain` through DRF's `perform_update`,
    which nothing wrapped, so the refusal escaped as an unhandled exception.
    The rule held and the answer was a 500 with an empty screen behind it,
    which is indistinguishable from a broken form.
    """
    submit(memo)
    proceed(memo, cast["a"], action=recommend)

    response = _client(cast["initiator"]).patch(
        f"{LIST}{memo.id}/",
        {"recommender_ids": [cast["b"].pk, cast["c"].pk]},
        format="json",
    )

    assert response.status_code == 400
    assert "already handled" in response.data["detail"]

    memo.refresh_from_db()
    assert [r.employee for r in memo.chain] == [cast["a"], cast["b"], cast["c"]]


def test_moving_the_approver_after_it_has_reached_them_is_a_400(memo, cast, recommend):
    """The other half of the same rule, refused the same way."""
    submit(memo)
    for who in ("a", "b", "c"):
        proceed(memo, cast[who], action=recommend)
    memo.refresh_from_db()
    assert memo.stage == Memorandum.Stage.APPROVE

    response = _client(cast["initiator"]).patch(
        f"{LIST}{memo.id}/", {"approver": cast["a"].pk}, format="json"
    )

    assert response.status_code == 400
    memo.refresh_from_db()
    assert memo.approver == cast["approver"]


# ── Comments carry people and files ──────────────────────────────────────


def _upload(name="survey.pdf", body=b"alignment"):
    from django.core.files.uploadedfile import SimpleUploadedFile

    return SimpleUploadedFile(name, body)


def test_a_comment_can_name_people_and_carry_files(memo, cast):
    submit(memo)

    response = _client(cast["a"]).post(
        f"{LIST}{memo.id}/comment/",
        {
            "comment": "Ground conditions — can you confirm?",
            "mention_ids": [str(cast["c"].pk)],
            "files": _upload(),
        },
        format="multipart",
    )

    assert response.status_code == 200
    event = response.data["events"][-1]
    assert event["kind"] == "commented"
    assert [m["id"] for m in event["mentions"]] == [cast["c"].pk]
    assert len(event["attachments"]) == 1


def test_a_file_on_a_comment_is_not_one_of_the_memorandums_annexes(memo, cast):
    """🔒 The freeze rule, kept honest.

    Annexes are part of the proposal and are fixed at submission — a chain that
    has read three of them must not find a fourth beneath its signatures. A file
    on a comment is a reply, not an annexe, so it must not appear in the
    memorandum's own attachment list or be counted in its badge.
    """
    submit(memo)
    _client(cast["a"]).post(
        f"{LIST}{memo.id}/comment/",
        {"comment": "Here it is.", "files": _upload()},
        format="multipart",
    )

    detail = _client(cast["initiator"]).get(f"{LIST}{memo.id}/").data
    assert detail["attachments"] == []
    assert detail["events"][-1]["attachments"] != []

    listed = _client(cast["initiator"]).get(LIST).data["results"]
    row = next(r for r in listed if r["id"] == memo.id)
    assert row["attachment_count"] == 0


def test_being_named_lets_somebody_read_the_memorandum(memo, cast, company):
    """A notice saying "you were mentioned on a document you cannot open" is
    worse than no notice. Mentioning grants reading, and only reading."""
    outsider = _person("m_out", "M-OUT", company)
    submit(memo)

    assert _client(outsider).get(f"{LIST}{memo.id}/").status_code == 404

    _client(cast["a"]).post(
        f"{LIST}{memo.id}/comment/",
        {"comment": "Please look at this.", "mention_ids": [str(outsider.pk)]},
        format="multipart",
    )

    assert _client(outsider).get(f"{LIST}{memo.id}/").status_code == 200
    # Reading is all it grants: they are not in the chain and cannot move it.
    assert _client(outsider).get(f"{LIST}{memo.id}/").data["can_act"] is False


def test_a_comment_with_only_a_file_is_still_a_comment(memo, cast):
    """Somebody sent back for a document often has nothing to add but the
    document. Refusing an empty-bodied comment would send the file to email."""
    submit(memo)

    response = _client(cast["a"]).post(
        f"{LIST}{memo.id}/comment/", {"files": _upload()}, format="multipart"
    )

    assert response.status_code == 200
    assert len(response.data["events"][-1]["attachments"]) == 1


def test_an_empty_comment_with_nothing_attached_is_refused(memo, cast):
    submit(memo)

    response = _client(cast["a"]).post(
        f"{LIST}{memo.id}/comment/", {"comment": "   "}, format="multipart"
    )

    assert response.status_code == 400


def test_a_decided_memorandum_takes_no_more_comments(memo, cast, recommend):
    """🔒 "Nothing on it can be changed" includes the conversation."""
    submit(memo)
    for who in ("a", "b", "c"):
        proceed(memo, cast[who], action=recommend)
    decide(memo, cast["approver"], approve=True)

    response = _client(cast["a"]).post(
        f"{LIST}{memo.id}/comment/",
        {"comment": "One more thing.", "files": _upload()},
        format="multipart",
    )

    assert response.status_code == 400
    memo.refresh_from_db()
    assert memo.attachments.count() == 0


def test_acting_out_of_turn_is_a_403_not_a_400(memo, cast, recommend):
    """🔒 The refusal an ordinary user hits most, with the right code on it.

    Somebody opens a memorandum that is two people ahead of them and presses
    the button. That is a question about *who is asking*, and the guards beside
    it — "only the initiator submits", "only the named approver decides" —
    already answer 403. This one answered 400, so a browser branching on 403 to
    say "not yours" showed a validation error instead.
    """
    submit(memo)

    # `c` is third in the chain; `a` is holding it.
    late = _client(cast["c"]).post(
        f"{LIST}{memo.id}/proceed/", {"action": recommend.pk}, format="json"
    )
    assert late.status_code == 403
    assert late.data["detail"] == "This memorandum is not with you."

    # The approver is not exempt: their turn has not come either.
    early = _client(cast["approver"]).post(
        f"{LIST}{memo.id}/approve/", {"comment": "early"}, format="json"
    )
    assert early.status_code == 403

    # And a genuinely bad request is still a 400, so the two stay distinguishable.
    no_action = _client(cast["a"]).post(f"{LIST}{memo.id}/proceed/", {}, format="json")
    assert no_action.status_code == 400


def test_a_table_survives_being_saved(memo, cast):
    """A memorandum that proposes a budget or lists tender bids *is* a table.
    Before this the tags were not on the allow-list, so the sanitiser threw the
    structure away and left the cell text run together as one paragraph — the
    author saw their table vanish on save with nothing to explain it."""
    html = (
        '<table style="width: 100%; border-collapse: collapse">'
        "<caption>Bids received</caption>"
        '<thead><tr><th colspan="2">Contractor</th><th>Amount</th></tr></thead>'
        "<tbody><tr><td>Himal Nirman</td><td>Butwal</td><td>4,20,000</td></tr></tbody>"
        "</table>"
    )
    response = _client(cast["initiator"]).patch(f"{LIST}{memo.pk}/", {"content": html}, format="json")

    assert response.status_code == 200, response.data
    memo.refresh_from_db()
    for tag in ("<table", "<caption>", "<thead>", "<tr>", "<th", "<td>"):
        assert tag in memo.content, f"{tag} was stripped"
    assert 'colspan="2"' in memo.content
    assert "border-collapse" in memo.content
    assert "Himal Nirman" in memo.content


def test_a_table_cannot_carry_an_event_handler_or_a_span_that_breaks_the_page(memo, cast):
    """Allowing tables must not quietly widen what an attribute may hold."""
    html = (
        '<table onmouseover="steal()">'
        '<tr><td colspan="99999" style="background-image: url(javascript:alert(1))">x</td>'
        '<td colspan="0">y</td><td colspan="nope">z</td></tr>'
        "</table>"
    )
    response = _client(cast["initiator"]).patch(f"{LIST}{memo.pk}/", {"content": html}, format="json")

    assert response.status_code == 200, response.data
    memo.refresh_from_db()
    assert "onmouseover" not in memo.content
    assert "steal()" not in memo.content
    assert "javascript:" not in memo.content
    assert "background-image" not in memo.content
    # Clamped to something a page can actually draw, and nonsense dropped
    # outright rather than guessed at.
    assert 'colspan="99999"' not in memo.content
    assert 'colspan="64"' in memo.content
    assert 'colspan="0"' not in memo.content
    assert 'colspan="nope"' not in memo.content


# ── Whose turn it is ─────────────────────────────────────────────────────

def test_the_holder_is_not_given_the_pen_either(memo, cast):
    """A recommender holds it, but the text is the initiator's. Holding it
    means acting on it — proceeding, returning — not rewriting it."""
    submit(memo)

    response = _client(cast["a"]).patch(
        f"{LIST}{memo.pk}/", {"content": "<p>My version.</p>"}, format="json"
    )

    assert response.status_code == 403, response.data


def test_a_draft_is_still_the_initiator_s_to_write(memo, cast):
    response = _client(cast["initiator"]).patch(
        f"{LIST}{memo.pk}/", {"content": "<p>Revised.</p>"}, format="json"
    )

    assert response.status_code == 200, response.data
    memo.refresh_from_db()
    assert "Revised." in memo.content


def test_sent_back_to_the_initiator_returns_the_pen(memo, cast):
    """The whole point of a return: somebody says the third paragraph is wrong
    and the initiator fixes the third paragraph."""
    submit(memo)
    send_back(memo, cast["a"], to=cast["initiator"], comment="Third paragraph is wrong.")
    memo.refresh_from_db()
    assert memo.current_holder_id == cast["initiator"].pk

    response = _client(cast["initiator"]).patch(
        f"{LIST}{memo.pk}/", {"content": "<p>Third paragraph fixed.</p>"}, format="json"
    )

    assert response.status_code == 200, response.data
    memo.refresh_from_db()
    assert "Third paragraph fixed." in memo.content


# ── Skipping somebody who is away ────────────────────────────────────────


def test_the_initiator_can_move_it_past_an_absent_recommender(memo, cast):
    """A recommender goes on leave and the memorandum stops dead on their desk:
    the chain has no timeout and the holder is the only one who can act."""
    submit(memo)
    memo.refresh_from_db()
    assert memo.current_holder_id == cast["a"].pk

    response = _client(cast["initiator"]).post(
        f"{LIST}{memo.pk}/skip/", {"comment": "On leave until Sunday."}, format="json"
    )

    assert response.status_code == 200, response.data
    memo.refresh_from_db()
    assert memo.current_holder_id == cast["b"].pk


def test_a_skip_is_logged_as_a_skip_and_not_as_a_recommendation(memo, cast):
    """The value of the chain is that the approver can see who has read it. An
    entry saying this person proceeded, when they never opened it, would make
    the log a lie."""
    submit(memo)
    _client(cast["initiator"]).post(f"{LIST}{memo.pk}/skip/", {}, format="json")

    kinds = list(memo.events.values_list("kind", flat=True))
    assert MemorandumEvent.Kind.SKIPPED in kinds
    assert MemorandumEvent.Kind.PROCEEDED not in kinds
    # And being skipped is not having acted, so they can still be returned to
    # and can still act if they come back before it is decided.
    assert not has_ever_acted(memo, cast["a"])


def test_only_the_initiator_can_skip(memo, cast):
    submit(memo)

    response = _client(cast["b"]).post(f"{LIST}{memo.pk}/skip/", {}, format="json")

    assert response.status_code == 403, response.data
    memo.refresh_from_db()
    assert memo.current_holder_id == cast["a"].pk


def test_the_approver_cannot_be_skipped(memo, cast, recommend):
    """There is nobody after them to send it to — it would be an approval that
    nobody gave."""
    submit(memo)
    for person in (cast["a"], cast["b"], cast["c"]):
        proceed(memo, person, action=recommend, comment="")
    memo.refresh_from_db()
    assert memo.stage == Memorandum.Stage.APPROVE

    response = _client(cast["initiator"]).post(f"{LIST}{memo.pk}/skip/", {}, format="json")

    assert response.status_code == 400, response.data


def test_the_chain_can_still_be_redrawn_while_somebody_else_holds_it(memo, cast):
    """Deliberately *not* gated on whose desk it is on. A recommender is off
    site with no signal; the initiator has to be able to route around them
    without waiting for the person who is absent."""
    submit(memo)

    response = _client(cast["initiator"]).patch(
        f"{LIST}{memo.pk}/",
        {"recommender_ids": [cast["a"].pk, cast["c"].pk]},
        format="json",
    )

    assert response.status_code == 200, response.data
    assert list(memo.recommenders.order_by("order").values_list("employee_id", flat=True)) == [
        cast["a"].pk,
        cast["c"].pk,
    ]


# ── Filing it away ───────────────────────────────────────────────────────


def test_the_initiator_can_archive_a_decided_memorandum(memo, cast, recommend):
    submit(memo)
    for person in (cast["a"], cast["b"], cast["c"]):
        proceed(memo, person, action=recommend, comment="")
    decide(memo, cast["approver"], approve=True)

    response = _client(cast["initiator"]).post(f"{LIST}{memo.pk}/archive/", {}, format="json")

    assert response.status_code == 200, response.data
    memo.refresh_from_db()
    assert memo.status == Memorandum.Status.ARCHIVED
    assert MemorandumEvent.Kind.ARCHIVED in memo.events.values_list("kind", flat=True)


def test_only_the_initiator_archives(memo, cast, recommend):
    submit(memo)
    for person in (cast["a"], cast["b"], cast["c"]):
        proceed(memo, person, action=recommend, comment="")
    decide(memo, cast["approver"], approve=True)

    response = _client(cast["approver"]).post(f"{LIST}{memo.pk}/archive/", {}, format="json")

    assert response.status_code == 403, response.data


def test_a_memorandum_still_with_somebody_cannot_be_archived(memo, cast):
    """That would take it off the holder's desk and leave them no way to act —
    a cancellation wearing the wrong word."""
    submit(memo)

    response = _client(cast["initiator"]).post(f"{LIST}{memo.pk}/archive/", {}, format="json")

    assert response.status_code == 400, response.data
    memo.refresh_from_db()
    assert memo.status == Memorandum.Status.IN_PROGRESS


def test_an_archived_memorandum_is_locked(memo, cast):
    _client(cast["initiator"]).post(f"{LIST}{memo.pk}/archive/", {}, format="json")
    memo.refresh_from_db()
    assert memo.status == Memorandum.Status.ARCHIVED

    response = _client(cast["initiator"]).patch(
        f"{LIST}{memo.pk}/", {"content": "<p>After the fact.</p>"}, format="json"
    )

    # 400, not 403: `is_locked` is the stronger rule and refuses in the
    # serializer before the whose-turn check is reached. Both are refusals;
    # this one says *why* in a way the turn rule cannot.
    assert response.status_code == 400, response.data
    memo.refresh_from_db()
    assert "After the fact" not in memo.content


# ── Filed under the right company ────────────────────────────────────────


def test_the_initiator_can_move_a_draft_to_another_company(memo, cast, company):
    """A draft has no number yet, so nothing has to be re-minted."""
    from companies.models import Company

    other = Company.objects.create(name="Seti Nadi Hydropower", code="SNHL")
    response = _client(cast["initiator"]).patch(
        f"{LIST}{memo.pk}/", {"company": other.pk}, format="json"
    )

    assert response.status_code == 200, response.data
    memo.refresh_from_db()
    assert memo.company_id == other.pk
    assert memo.memo_id in (None, "")


def test_moving_a_numbered_memorandum_re_mints_its_reference(memo, cast, company):
    """The company is the middle segment of the reference. A memorandum filed
    as `…-VLUCL-0007` that now belongs to Seti Nadi is mis-filed."""
    from companies.models import Company

    submit(memo)
    memo.refresh_from_db()
    original = memo.memo_id
    assert company.code in original

    send_back(memo, cast["a"], to=cast["initiator"], comment="Wrong company.")
    other = Company.objects.create(name="Seti Nadi Hydropower", code="SNHL")

    response = _client(cast["initiator"]).patch(
        f"{LIST}{memo.pk}/", {"company": other.pk}, format="json"
    )

    assert response.status_code == 200, response.data
    memo.refresh_from_db()
    assert memo.memo_id != original
    assert "SNHL" in memo.memo_id
    # The serial comes from the new company's own register, which starts at 1.
    assert memo.memo_id.endswith("-0001")
    # And the change is on the record, because the reference somebody quoted
    # yesterday is not the reference today.
    assert any(original in (e.comment or "") for e in memo.events.all())


def test_the_company_cannot_be_changed_from_somebody_else_s_desk(memo, cast, company):
    from companies.models import Company

    submit(memo)
    other = Company.objects.create(name="Seti Nadi Hydropower", code="SNHL")

    response = _client(cast["initiator"]).patch(
        f"{LIST}{memo.pk}/", {"company": other.pk}, format="json"
    )

    assert response.status_code == 403, response.data
    memo.refresh_from_db()
    assert memo.company_id == company.pk


def test_a_recommender_holding_it_cannot_change_the_company(memo, cast, company):
    """The company is the initiator's to set, not the holder's. Holding a
    memorandum means acting on it — proceeding, returning — not re-filing it
    under a different company and changing its reference number."""
    from companies.models import Company

    submit(memo)
    memo.refresh_from_db()
    assert memo.current_holder_id == cast["a"].pk

    other = Company.objects.create(name="Seti Nadi Hydropower", code="SNHL")
    response = _client(cast["a"]).patch(f"{LIST}{memo.pk}/", {"company": other.pk}, format="json")

    assert response.status_code == 403, response.data
    memo.refresh_from_db()
    assert memo.company_id == company.pk


def test_the_initiator_can_change_the_company_when_it_is_sent_back(memo, cast, company):
    """Their turn is a draft *or* a return — the same rule the text follows."""
    from companies.models import Company

    submit(memo)
    original = Memorandum.objects.get(pk=memo.pk).memo_id
    send_back(memo, cast["a"], to=cast["initiator"], comment="Wrong company.")
    other = Company.objects.create(name="Seti Nadi Hydropower", code="SNHL")

    response = _client(cast["initiator"]).patch(
        f"{LIST}{memo.pk}/", {"company": other.pk}, format="json"
    )

    assert response.status_code == 200, response.data
    memo.refresh_from_db()
    assert memo.company_id == other.pk
    assert memo.memo_id != original and "SNHL" in memo.memo_id




# ── Signing, which is an act ─────────────────────────────────────────────
#
# These replace four tests that asserted a signature appeared automatically as
# soon as somebody recommended or approved. That behaviour is gone: a mark a
# workflow applied on your behalf means nothing by it, so signing is a button
# somebody presses and a place they drag it to.


def _signed(employee, status="approved"):
    """An approved signature for somebody, as a one-pixel PNG."""
    import base64

    from django.core.files.base import ContentFile

    from employees.models import Signature

    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    row = Signature.objects.create(employee=employee, status=status)
    row.image.save("sig.png", ContentFile(png), save=True)
    return row


def test_nothing_is_signed_until_somebody_signs(memo, cast, recommend):
    """The point of the change: recommending is not signing."""
    _signed(cast["a"])
    submit(memo)
    proceed(memo, cast["a"], action=recommend, comment="Recommended.")

    response = _client(cast["initiator"]).get(f"{LIST}{memo.pk}/")

    assert response.data["signatures"] == []


def test_signing_places_your_own_mark(memo, cast):
    _signed(cast["a"])
    submit(memo)

    response = _client(cast["a"]).post(f"{LIST}{memo.pk}/sign/", {}, format="json")

    assert response.status_code == 200, response.data
    placed = response.data["signatures"]
    assert len(placed) == 1
    assert placed[0]["employee"] == cast["a"].pk
    assert placed[0]["role"] == "recommender"


def test_signing_twice_is_refused(memo, cast):
    """Signing twice is not a stronger endorsement; it is a mistake."""
    _signed(cast["a"])
    submit(memo)
    _client(cast["a"]).post(f"{LIST}{memo.pk}/sign/", {}, format="json")

    response = _client(cast["a"]).post(f"{LIST}{memo.pk}/sign/", {}, format="json")

    assert response.status_code == 400, response.data


def test_you_cannot_sign_without_an_approved_signature(memo, cast):
    """A pending upload is a picture somebody sent in."""
    _signed(cast["a"], status="pending")
    submit(memo)

    response = _client(cast["a"]).post(f"{LIST}{memo.pk}/sign/", {}, format="json")

    assert response.status_code == 400, response.data
    assert "no approved signature" in str(response.data).lower()


def test_a_signature_can_be_dragged_and_stays_where_it_is_put(memo, cast):
    _signed(cast["a"])
    submit(memo)
    _client(cast["a"]).post(f"{LIST}{memo.pk}/sign/", {}, format="json")

    response = _client(cast["a"]).patch(
        f"{LIST}{memo.pk}/sign/place/", {"x": 0.25, "y": 0.4, "page": 1}, format="json"
    )

    assert response.status_code == 200, response.data
    placed = response.data["signatures"][0]
    assert placed["x"] == 0.25 and placed["y"] == 0.4 and placed["page"] == 1


def test_a_drag_off_the_sheet_is_snapped_back(memo, cast):
    """A slip, not a bad request."""
    _signed(cast["a"])
    submit(memo)
    _client(cast["a"]).post(f"{LIST}{memo.pk}/sign/", {}, format="json")

    response = _client(cast["a"]).patch(
        f"{LIST}{memo.pk}/sign/place/", {"x": 1.8, "y": -0.3}, format="json"
    )

    placed = response.data["signatures"][0]
    assert placed["x"] == 1.0 and placed["y"] == 0.0


def test_a_signature_can_be_taken_off_again(memo, cast):
    _signed(cast["a"])
    submit(memo)
    _client(cast["a"]).post(f"{LIST}{memo.pk}/sign/", {}, format="json")

    response = _client(cast["a"]).delete(f"{LIST}{memo.pk}/sign/")

    assert response.status_code == 200, response.data
    assert response.data["signatures"] == []


def test_a_decided_memorandum_cannot_be_signed(memo, cast, recommend):
    """Sign the paper, then approve it — not the other way round. A signature
    appearing after the decision would be a document that changed after it was
    decided."""
    _signed(cast["a"])
    submit(memo)
    for person in (cast["a"], cast["b"], cast["c"]):
        proceed(memo, person, action=recommend, comment="")
    decide(memo, cast["approver"], approve=True)

    response = _client(cast["a"]).post(f"{LIST}{memo.pk}/sign/", {}, format="json")

    assert response.status_code == 400, response.data
