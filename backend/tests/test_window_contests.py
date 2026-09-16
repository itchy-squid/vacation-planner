"""Proposing a block: what a claimed window sweeps up, and what it refuses.

See docs/features/proposals-and-expenses-feature-spec.md §6.2.
"""

from app.models import Contest, ContestStatus, Plan, PlanStatus
from app.tripclock import same_moment

from conftest import as_user, at


def reload(db):
    """The API runs in its own session, so the test session's identity map
    is stale the moment a request lands. Expiring is how a test asserts
    against what's actually in the database rather than what it last saw."""
    db.expire_all()


def propose(client, trip, *, day=1, start, end, stops, user="jae", label="", rationale=""):
    return client.post(
        f"/api/trips/{trip.id}/contests",
        json={
            "starts_at": at(day, start).isoformat(),
            "ends_at": at(day, end).isoformat(),
            "label": label,
            "rationale": rationale,
            "items": [
                {"pin_id": trip.pins[key].id, **({"duration_minutes": dur} if dur else {})}
                for key, dur in stops
            ],
        },
        headers=as_user(f"{user}@example.com"),
    )


def test_window_over_nothing_opens_a_single_option_contest(client, trip, db):
    """A day with no existing items is a legal claim — the handoff's own
    edge case. There is simply nothing to compare against yet."""
    res = propose(client, trip, start=780, end=1080, stops=[("vase", None)])
    assert res.status_code == 201, res.text

    body = res.json()
    assert len(body["plans"]) == 1
    assert body["plans"][0]["set_letter"] == "A"
    assert body["starts_at"].startswith("2026-10-03T13:00")
    assert body["ends_at"].startswith("2026-10-03T18:00")


def test_window_over_one_plan_captures_it(client, trip, db):
    # Read the id out now: after the capture the row is gone, and a
    # lazy-loaded attribute on the expired object would raise rather than
    # answer.
    existing_id = trip.place(start=840, end=900, pin="tide").id

    res = propose(client, trip, start=780, end=1080, stops=[("vase", None)])
    assert res.status_code == 201, res.text
    body = res.json()

    # Two options: the incumbent (A) and the proposal (B).
    assert [p["set_letter"] for p in body["plans"]] == ["A", "B"]
    incumbent = body["plans"][0]
    assert [i["pin"]["title"] for i in incumbent["items"]] == ["Meirendong tide pools"]

    # The captured plan is gone, replaced by an option spanning the window.
    reload(db)
    assert db.get(Plan, existing_id) is None
    assert incumbent["starts_at"].startswith("2026-10-03T13:00")
    assert incumbent["ends_at"].startswith("2026-10-03T18:00")


def test_capture_preserves_each_stops_clock_time(client, trip, db):
    """Three plans at 14:00, 15:30 and 17:00 inside a 13:00–18:00 claim
    have to keep reading as 14:00 / 15:30 / 17:00 on the compare screen,
    not slide to the window's start."""
    trip.place(start=840, end=910, pin="tide")     # 14:00
    trip.place(start=930, end=1010, pin="trail")   # 15:30
    trip.place(start=1020, end=1065, pin="cave")   # 17:00

    res = propose(client, trip, start=780, end=1080, stops=[("vase", None)])
    assert res.status_code == 201, res.text

    incumbent = res.json()["plans"][0]
    assert [i["offset_minutes"] for i in incumbent["items"]] == [60, 150, 240]
    assert [i["start_minute_of_day"] for i in incumbent["items"]] == [840, 930, 1020]
    assert [i["pin"]["title"] for i in incumbent["items"]] == [
        "Meirendong tide pools",
        "Wild Boy trail loop",
        "Black Dwarf cave",
    ]
    reload(db)
    assert db.query(Plan).filter(Plan.status == PlanStatus.placed).count() == 0


def test_capture_preserves_a_duration_override(client, trip, db):
    """A stop already trimmed on the board stays trimmed once captured —
    the override is what the plan says, not what the pin says."""
    trip.place(start=840, end=900, pin="trail", items=[("trail", 60)])  # an 80m pin, trimmed to 60

    res = propose(client, trip, start=780, end=1080, stops=[("vase", None)])
    incumbent = res.json()["plans"][0]

    assert incumbent["items"][0]["duration_minutes"] == 60
    assert incumbent["items"][0]["pin"]["duration_minutes"] == 80
    assert incumbent["total_duration_minutes"] == 60


def test_proposal_stops_pack_from_the_window_start(client, trip):
    res = propose(client, trip, start=780, end=1080, stops=[("vase", None), ("ice", None)])
    proposal = res.json()["plans"][-1]

    # 50m then 30m, packed end to end from 13:00 — and no offsets stored,
    # because packing *is* the rule for a proposal.
    assert [i["offset_minutes"] for i in proposal["items"]] == [None, None]
    assert [i["start_minute_of_day"] for i in proposal["items"]] == [780, 830]
    assert proposal["total_duration_minutes"] == 80
    assert proposal["slack_minutes"] == 220


def test_exactly_matching_window_adds_a_further_option(client, trip):
    trip.place(start=840, end=900, pin="tide")
    first = propose(client, trip, start=780, end=1080, stops=[("vase", None)], user="jae")
    assert first.status_code == 201
    contest_id = first.json()["id"]

    second = propose(client, trip, start=780, end=1080, stops=[("trail", None)], user="ana")
    assert second.status_code == 201, second.text
    body = second.json()

    assert body["id"] == contest_id
    assert [p["set_letter"] for p in body["plans"]] == ["A", "B", "C"]


def test_partial_overlap_of_an_open_contest_is_refused(client, trip):
    trip.place(start=840, end=900, pin="tide")
    first = propose(client, trip, start=780, end=1080, stops=[("vase", None)])
    contest_id = first.json()["id"]

    clash = propose(client, trip, start=900, end=1200, stops=[("trail", None)])
    assert clash.status_code == 409
    detail = clash.json()["detail"]
    assert detail["contest_id"] == contest_id
    # The hours already out for a vote are named, so step 2 can say which
    # part of the drag is the problem.
    assert detail["starts_at"].startswith("2026-10-03T13:00")
    assert detail["ends_at"].startswith("2026-10-03T18:00")


def test_a_locked_plan_is_never_captured(client, trip, db):
    """A pinned item — the ferry, the handoff's gangway — is a fixed hour.
    The selection clips at one rather than crossing it, so a window that
    contains one can only be a race or a client bug."""
    ferry_id = trip.place(start=840, end=915, travel_item="ferry", status=PlanStatus.locked).id

    res = propose(client, trip, start=780, end=1080, stops=[("vase", None)])
    assert res.status_code == 409
    assert res.json()["detail"]["locked_plan_id"] == ferry_id

    reload(db)
    survivor = db.get(Plan, ferry_id)
    assert survivor is not None and survivor.status == PlanStatus.locked
    assert db.query(Contest).count() == 0


def test_a_window_beside_a_locked_plan_is_fine(client, trip, db):
    """Clipping means claiming right up to the locked plan's edge, and a
    plan ending exactly when another starts has never counted as overlap."""
    trip.place(start=1020, end=1095, travel_item="ferry", status=PlanStatus.locked)

    res = propose(client, trip, start=780, end=1020, stops=[("vase", None)])
    assert res.status_code == 201, res.text
    reload(db)
    assert db.query(Contest).count() == 1


def test_a_proposal_carries_its_name_and_rationale(client, trip):
    res = propose(
        client,
        trip,
        start=780,
        end=1080,
        stops=[("vase", None)],
        label="Ruins first, beach after",
        rationale="The tide is wrong for the pools before four.",
    )
    proposal = res.json()["plans"][-1]
    assert proposal["label"] == "Ruins first, beach after"
    assert proposal["rationale"] == "The tide is wrong for the pools before four."


def test_the_same_item_cannot_appear_twice_in_one_proposal(client, trip):
    res = propose(client, trip, start=780, end=1080, stops=[("vase", None), ("vase", None)])
    assert res.status_code == 400


def test_stops_may_not_outlast_the_window(client, trip):
    res = propose(client, trip, start=780, end=840, stops=[("vase", 90)])
    assert res.status_code == 400


def test_a_backwards_window_is_refused(client, trip):
    res = propose(client, trip, start=1080, end=780, stops=[("vase", None)])
    assert res.status_code == 400


def test_contest_opens_with_its_window_set(client, trip, db):
    propose(client, trip, start=780, end=1080, stops=[("vase", None)])
    reload(db)
    contest = db.query(Contest).one()
    assert contest.status == ContestStatus.open
    # same_moment, not ==: SQLite hands tz-aware columns back naive (see
    # app/tripclock.py), which is exactly the mismatch that helper exists
    # to absorb.
    assert same_moment(contest.starts_at, at(1, 780))
    assert same_moment(contest.ends_at, at(1, 1080))
