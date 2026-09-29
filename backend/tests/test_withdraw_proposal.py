"""Withdrawing a proposal you own: POST /api/plans/{id}/withdraw.

What is left in the vote decides what happens to the hours: other sets
carry on, a lone set on the board hands the hours back to what was there,
and an empty vote is simply deleted.
"""

from sqlalchemy import select

from app.models import Contest, Plan, PlanStatus, TravelItem, Vote

from conftest import as_user
from test_window_contests import propose, reload

JAE = as_user("jae@example.com")
MEI = as_user("mei@example.com")
ANA = as_user("ana@example.com")


def withdraw(client, plan_id, headers=JAE):
    return client.post(f"/api/plans/{plan_id}/withdraw", headers=headers)


def vote(client, contest_id, plan_id, headers):
    res = client.post(f"/api/contests/{contest_id}/vote", json={"plan_id": plan_id}, headers=headers)
    assert res.status_code == 200, res.text


def test_withdrawing_the_only_set_deletes_the_vote(client, trip, db):
    contest = propose(client, trip, start=780, end=900, stops=[("vase", None)]).json()
    (plan,) = contest["plans"]

    res = withdraw(client, plan["id"])
    assert res.status_code == 200, res.text
    assert res.json() == {"contest": None, "placed_plans": []}

    reload(db)
    assert db.get(Contest, contest["id"]) is None
    assert db.get(Plan, plan["id"]) is None


def test_withdrawing_over_the_board_puts_the_board_back(client, trip, db):
    """The hours were claimed over an existing plan, which was folded into
    the incumbent. With the proposal gone there is nothing to decide, so it
    comes back as the ordinary plan it was."""
    trip.place(start=840, end=900, pin="tide")
    contest = propose(client, trip, start=780, end=960, stops=[("vase", None)]).json()
    proposal = next(p for p in contest["plans"] if p["created_by_id"] is not None)

    res = withdraw(client, proposal["id"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["contest"] is None
    (placed,) = body["placed_plans"]
    assert placed["status"] == "placed"
    assert placed["starts_at"].startswith("2026-10-03T14:00")
    assert placed["ends_at"].startswith("2026-10-03T15:10")  # the pin's own 70 minutes

    reload(db)
    assert db.get(Contest, contest["id"]) is None
    assert db.scalars(select(Plan).where(Plan.status == PlanStatus.contested)).all() == []


def test_withdrawing_one_of_several_sets_keeps_the_vote(client, trip, db):
    contest = propose(client, trip, start=780, end=900, stops=[("vase", None)], user="jae").json()
    (mine,) = contest["plans"]
    other = client.post(
        f"/api/trips/{trip.id}/contests",
        json={
            "starts_at": contest["starts_at"],
            "ends_at": contest["ends_at"],
            "items": [{"pin_id": trip.pins["tide"].id}],
        },
        headers=MEI,
    )
    assert other.status_code == 201, other.text
    theirs = next(p for p in other.json()["plans"] if p["id"] != mine["id"])
    vote(client, contest["id"], mine["id"], ANA)

    res = withdraw(client, mine["id"])
    assert res.status_code == 200, res.text
    assert [p["id"] for p in res.json()["contest"]["plans"]] == [theirs["id"]]

    reload(db)
    assert db.get(Plan, mine["id"]) is None
    assert db.get(Plan, theirs["id"]) is not None
    assert db.scalars(select(Vote).where(Vote.plan_id == mine["id"])).all() == []


def test_a_custom_event_only_the_withdrawn_set_used_is_forgotten(client, trip, db):
    contest = client.post(
        f"/api/trips/{trip.id}/contests",
        json={
            "starts_at": "2026-10-03T13:00:00+08:00",
            "ends_at": "2026-10-03T15:00:00+08:00",
            "items": [{"travel_item_id": trip.travel_items["ferry"].id}],
        },
        headers=JAE,
    )
    assert contest.status_code == 201, contest.text
    item_id = trip.travel_items["ferry"].id
    (plan,) = contest.json()["plans"]

    assert withdraw(client, plan["id"]).status_code == 200
    reload(db)
    assert db.get(TravelItem, item_id) is None


def test_only_the_author_or_the_owner_can_withdraw(client, trip, db):
    contest = propose(client, trip, start=780, end=900, stops=[("vase", None)], user="jae").json()
    (plan,) = contest["plans"]

    assert withdraw(client, plan["id"], headers=ANA).status_code == 403
    reload(db)
    assert db.get(Plan, plan["id"]) is not None

    # Mei owns the trip.
    assert withdraw(client, plan["id"], headers=MEI).status_code == 200
    reload(db)
    assert db.get(Plan, plan["id"]) is None


def test_the_incumbent_cannot_be_withdrawn(client, trip, db):
    trip.place(start=840, end=900, pin="tide")
    contest = propose(client, trip, start=780, end=960, stops=[("vase", None)]).json()
    incumbent = next(p for p in contest["plans"] if p["created_by_id"] is None)

    assert withdraw(client, incumbent["id"]).status_code == 409


def test_a_placed_plan_cannot_be_withdrawn(client, trip):
    plan = trip.place(start=840, end=900, pin="tide")
    assert withdraw(client, plan.id).status_code == 409
