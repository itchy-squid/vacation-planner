"""Votes, majority, locking and reopening across a window contest.

See docs/features/proposals-and-expenses-feature-spec.md §6.3 and §11.
"""

from app.models import Contest, ContestStatus, Plan, PlanStatus

from conftest import as_user, at


def open_contest(client, trip):
    """A contest with an incumbent (A) and one proposal (B), on 13:00-18:00
    of day 1."""
    trip.place(start=840, end=900, pin="tide")
    res = client.post(
        f"/api/trips/{trip.id}/contests",
        json={
            "starts_at": at(1, 780).isoformat(),
            "ends_at": at(1, 1080).isoformat(),
            "items": [{"pin_id": trip.pins["vase"].id}],
        },
        headers=as_user("jae@example.com"),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    return body["id"], body["plans"][0]["id"], body["plans"][1]["id"]


def test_majority_needs_strictly_more_than_half(client, trip):
    """Four contributors: two votes is a tie, not a majority."""
    contest_id, incumbent_id, proposal_id = open_contest(client, trip)

    trip.vote(contest_id, proposal_id, "jae", "ana")
    body = client.get(f"/api/contests/{contest_id}").json()
    assert body["contributor_count"] == 4
    assert body["majority_plan_id"] is None

    trip.vote(contest_id, proposal_id, "lin")
    body = client.get(f"/api/contests/{contest_id}").json()
    assert body["majority_plan_id"] == proposal_id
    assert body["status"] == "open"
    # Advisory only — a majority does not resolve anything by itself.
    assert body["winning_plan_id"] is None
    assert incumbent_id != proposal_id


def test_withdrawing_a_vote_withdraws_the_majority(client, trip):
    contest_id, _incumbent_id, proposal_id = open_contest(client, trip)
    trip.vote(contest_id, proposal_id, "jae", "ana", "lin")
    assert client.get(f"/api/contests/{contest_id}").json()["majority_plan_id"] == proposal_id

    # Voting for the plan you already voted for clears it.
    res = client.post(
        f"/api/contests/{contest_id}/vote",
        json={"plan_id": proposal_id},
        headers=as_user("lin@example.com"),
    )
    assert res.status_code == 200
    assert res.json()["majority_plan_id"] is None


def test_locking_keeps_the_winner_and_clears_the_rest(client, trip, db):
    contest_id, incumbent_id, proposal_id = open_contest(client, trip)

    res = client.post(
        f"/api/contests/{contest_id}/lock",
        json={"plan_id": proposal_id},
        headers=as_user("mei@example.com"),  # the owner
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "resolved"
    assert body["winning_plan_id"] == proposal_id

    db.expire_all()
    assert db.get(Plan, incumbent_id) is None
    winner = db.get(Plan, proposal_id)
    assert winner.status == PlanStatus.locked
    # The winner keeps the whole window — that's what makes it safe to have
    # deleted everything that used to be in those hours.
    assert winner.starts_at.hour == 13 and winner.ends_at.hour == 18


def test_only_the_owner_can_lock(client, trip):
    contest_id, _incumbent_id, proposal_id = open_contest(client, trip)
    res = client.post(
        f"/api/contests/{contest_id}/lock",
        json={"plan_id": proposal_id},
        headers=as_user("jae@example.com"),
    )
    assert res.status_code == 403


def test_reopening_puts_the_window_back_out_for_a_vote(client, trip, db):
    contest_id, _incumbent_id, proposal_id = open_contest(client, trip)
    client.post(
        f"/api/contests/{contest_id}/lock",
        json={"plan_id": proposal_id},
        headers=as_user("mei@example.com"),
    )

    res = client.post(f"/api/plans/{proposal_id}/reopen", headers=as_user("mei@example.com"))
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "placed"

    db.expire_all()
    contest = db.get(Contest, contest_id)
    assert contest.status == ContestStatus.open
    assert contest.winning_plan_id is None
    # Reopening does not un-merge the incumbent it captured, exactly as it
    # doesn't restore the options locking deleted.
    assert db.query(Plan).count() == 1


def test_reopening_into_hours_that_have_since_been_filled_409s(client, trip, db):
    """Reopening drops a plan back to `placed`, which is a status that has
    to obey the overlap rule — so if anything has since landed in those
    hours, the reopen has to refuse rather than create an overlap the
    calendar has no way to draw.

    The overlapping plan is written straight to the database here because
    the placement endpoint would (correctly) refuse it: a locked plan
    occupies its hours like any other. What this guards is the narrow race
    where a placement and a reopen interleave — and data written by an
    older code path, which is exactly the sort of thing that outlives the
    rule that used to prevent it."""
    contest_id, _incumbent_id, proposal_id = open_contest(client, trip)
    client.post(
        f"/api/contests/{contest_id}/lock",
        json={"plan_id": proposal_id},
        headers=as_user("mei@example.com"),
    )

    squatter_id = trip.place(start=900, end=960, pin="ice").id

    res = client.post(f"/api/plans/{proposal_id}/reopen", headers=as_user("mei@example.com"))
    assert res.status_code == 409
    assert res.json()["detail"]["occupying_plan_id"] == squatter_id

    db.expire_all()
    assert db.get(Plan, proposal_id).status == PlanStatus.locked


def test_a_409_on_placement_names_the_open_contest(client, trip):
    """So a client can offer "add a set to the open vote" rather than
    always opening a fresh propose sheet."""
    contest_id, _incumbent_id, _proposal_id = open_contest(client, trip)

    res = client.post(
        f"/api/trips/{trip.id}/plans",
        json={
            "starts_at": at(1, 900).isoformat(),
            "ends_at": at(1, 960).isoformat(),
            "status": "placed",
            "items": [{"pin_id": trip.pins["ice"].id}],
        },
        headers=as_user("ana@example.com"),
    )
    assert res.status_code == 409
    assert res.json()["detail"]["occupying_contest_id"] == contest_id


def test_locking_a_plan_directly_never_touches_a_neighbour(client, trip, db):
    """Locking is not capture: nothing outside the plan itself changes."""
    ferry_id = trip.place(start=480, end=555, travel_item="ferry").id
    neighbour_id = trip.place(start=570, end=640, pin="tide").id

    res = client.post(f"/api/plans/{ferry_id}/lock", headers=as_user("mei@example.com"))
    assert res.status_code == 200

    db.expire_all()
    assert db.get(Plan, ferry_id).status == PlanStatus.locked
    assert db.get(Plan, neighbour_id).status == PlanStatus.placed
