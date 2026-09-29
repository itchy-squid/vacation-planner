"""Moving a proposal's hours: PATCH /api/contests/{id}.

A proposal with nothing competing for its hours is dragged on the day grid
the same way a placed plan is. Once anything else is in the vote, the
window is the question everyone is answering and it stays put.
"""

from app.models import Contest, Plan, Vote

from conftest import as_user, at
from test_window_contests import propose, reload

JAE = as_user("jae@example.com")
MEI = as_user("mei@example.com")
ANA = as_user("ana@example.com")


def move(client, contest_id, *, day=1, start, end, headers=JAE):
    return client.patch(
        f"/api/contests/{contest_id}",
        json={"starts_at": at(day, start).isoformat(), "ends_at": at(day, end).isoformat()},
        headers=headers,
    )


def lone_proposal(client, trip, *, start=780, end=900, stops=(("vase", None), ("ice", None))):
    res = propose(client, trip, start=start, end=end, stops=list(stops))
    assert res.status_code == 201, res.text
    body = res.json()
    assert len(body["plans"]) == 1
    return body


def test_a_lone_proposal_moves_with_its_stops(client, trip, db):
    contest = lone_proposal(client, trip)  # 13:00–15:00: Vase Rock 50m, then shaved ice

    res = move(client, contest["id"], start=960, end=1080)  # 16:00–18:00
    assert res.status_code == 200, res.text

    body = res.json()
    assert body["starts_at"].startswith("2026-10-03T16:00")
    assert body["ends_at"].startswith("2026-10-03T18:00")
    (plan,) = body["plans"]
    assert plan["starts_at"].startswith("2026-10-03T16:00")
    assert plan["ends_at"].startswith("2026-10-03T18:00")
    # Stops are measured from the window's start, so they ride along.
    assert [i["start_minute_of_day"] for i in plan["items"]] == [960, 1010]

    reload(db)
    stored = db.get(Contest, contest["id"])
    assert stored.starts_at.replace(tzinfo=None) == at(1, 960).replace(tzinfo=None)
    assert db.get(Plan, plan["id"]).contest_id == contest["id"]


def test_a_lone_proposal_can_move_to_another_day(client, trip):
    contest = lone_proposal(client, trip)

    res = move(client, contest["id"], day=2, start=600, end=720)
    assert res.status_code == 200, res.text
    assert res.json()["starts_at"].startswith("2026-10-04T10:00")


def test_the_trip_owner_can_move_someone_elses_proposal(client, trip):
    contest = lone_proposal(client, trip)
    assert move(client, contest["id"], start=960, end=1080, headers=MEI).status_code == 200


def test_only_the_author_or_owner_can_move_it(client, trip):
    contest = lone_proposal(client, trip)
    res = move(client, contest["id"], start=960, end=1080, headers=ANA)
    assert res.status_code == 403


def test_a_proposal_with_a_competing_set_stays_put(client, trip):
    """An incumbent from the board is competition too: the vote is about
    whether to keep what was in those hours."""
    trip.place(start=780, end=840, pin="tide")
    res = propose(client, trip, start=780, end=900, stops=[("vase", None)])
    assert len(res.json()["plans"]) == 2

    moved = move(client, res.json()["id"], start=960, end=1080)
    assert moved.status_code == 409
    assert "can't be moved" in moved.json()["detail"]


def test_a_second_proposal_for_the_same_hours_pins_the_window(client, trip):
    contest = lone_proposal(client, trip, stops=[("vase", None)])
    again = propose(client, trip, start=780, end=900, stops=[("ice", None)], user="ana")
    assert len(again.json()["plans"]) == 2

    assert move(client, contest["id"], start=960, end=1080).status_code == 409


def test_moving_onto_another_plan_is_refused(client, trip):
    trip.place(start=1020, end=1080, pin="tide")
    contest = lone_proposal(client, trip)

    res = move(client, contest["id"], start=960, end=1080)
    assert res.status_code == 409
    assert res.json()["detail"]["message"]


def test_moving_onto_another_vote_is_refused(client, trip):
    first = lone_proposal(client, trip, start=780, end=900)
    lone_proposal(client, trip, start=960, end=1080)

    assert move(client, first["id"], start=900, end=1020).status_code == 409


def test_moving_it_so_it_touches_a_neighbour_is_fine(client, trip):
    trip.place(start=1080, end=1140, pin="tide")
    contest = lone_proposal(client, trip)

    assert move(client, contest["id"], start=960, end=1080).status_code == 200


def test_moving_it_into_split_hours_is_refused(client, trip):
    trip.split(("ana", "lin"), ("mei", "jae"), start=960, end=1200)
    contest = lone_proposal(client, trip)

    res = move(client, contest["id"], start=960, end=1080)
    assert res.status_code == 409
    assert "split" in res.json()["detail"]["message"]


def test_the_window_still_has_to_hold_its_stops(client, trip):
    contest = lone_proposal(client, trip)  # 80 minutes of stops
    res = move(client, contest["id"], start=960, end=1020)  # an hour
    assert res.status_code == 400


def test_moving_it_clears_the_votes_for_it(client, trip, db):
    contest = lone_proposal(client, trip)
    plan_id = contest["plans"][0]["id"]
    trip.vote(contest["id"], plan_id, "mei", "ana")

    res = move(client, contest["id"], start=960, end=1080)
    assert res.status_code == 200, res.text
    assert res.json()["voted_count"] == 0

    reload(db)
    assert db.query(Vote).filter(Vote.contest_id == contest["id"]).count() == 0


def test_a_missing_contest_is_404(client, trip):
    assert move(client, 999, start=960, end=1080).status_code == 404
