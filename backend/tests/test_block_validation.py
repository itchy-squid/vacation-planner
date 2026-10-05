"""What every path that stores a block checks about the body it was sent:
stops that belong to this trip, hours that run forwards, each stop once —
and that a vote names one of the contest's own options.

Ids in a request body are only the caller's word. Before these checks, a
member of one trip could put another trip's pin into their own plan and
read its details back from the plan response.
"""

import pytest

from app.models import Contributor, Pin, Plan, PlanItem, TravelItem, Trip, Vote

from conftest import TRIP_DAY_ONE, as_user, at


@pytest.fixture
def other_trip(db):
    """Somebody else's trip that no one in `trip` is on."""
    row = Trip(name="Kyoto", region_line="Higashiyama", start_date=TRIP_DAY_ONE)
    db.add(row)
    db.flush()
    db.add(Contributor(trip_id=row.id, email="zoe@example.com", display_name="Zoe", initial="Z", is_owner=True))
    pin = Pin(
        trip_id=row.id, title="Zoe's secret spot", place="Secret", region="Kyoto",
        duration_minutes=60, notes="door code 4412",
    )
    item = TravelItem(trip_id=row.id, title="Zoe's train", kind="other", duration_minutes=60)
    db.add_all([pin, item])
    db.commit()
    return {"trip": row, "pin": pin, "travel_item": item}


def block(*, start=780, end=900, items, status=None, day=1):
    body = {"start_min": at(day, start), "end_min": at(day, end), "items": items}
    if status:
        body["status"] = status
    return body


def plan_count(db, trip_id):
    return db.query(Plan).filter(Plan.trip_id == trip_id).count()


# --- stops from another trip ------------------------------------------------------


@pytest.mark.parametrize("status", ["placed", "draft"])
def test_placing_another_trips_pin_is_a_404(client, trip, other_trip, db, status):
    res = client.post(
        f"/api/trips/{trip.id}/plans",
        json=block(items=[{"pin_id": other_trip["pin"].id}], status=status),
        headers=as_user("mei@example.com"),
    )
    assert res.status_code == 404, res.text
    assert "door code" not in res.text
    assert plan_count(db, trip.id) == 0


def test_placing_another_trips_travel_item_is_a_404(client, trip, other_trip, db):
    res = client.post(
        f"/api/trips/{trip.id}/plans",
        json=block(items=[{"travel_item_id": other_trip["travel_item"].id}]),
        headers=as_user("mei@example.com"),
    )
    assert res.status_code == 404, res.text
    assert plan_count(db, trip.id) == 0


def test_proposing_with_another_trips_pin_is_a_404(client, trip, other_trip, db):
    res = client.post(
        f"/api/trips/{trip.id}/contests",
        json=block(items=[{"pin_id": trip.pins["vase"].id}, {"pin_id": other_trip["pin"].id}]),
        headers=as_user("jae@example.com"),
    )
    assert res.status_code == 404, res.text
    assert plan_count(db, trip.id) == 0


def test_editing_a_set_to_hold_another_trips_pin_is_a_404(client, trip, other_trip, db):
    created = client.post(
        f"/api/trips/{trip.id}/contests",
        json=block(items=[{"pin_id": trip.pins["vase"].id}]),
        headers=as_user("jae@example.com"),
    )
    assert created.status_code == 201, created.text
    proposal_id = created.json()["plans"][-1]["id"]

    res = client.put(
        f"/api/plans/{proposal_id}/stops",
        json={"items": [{"pin_id": other_trip["pin"].id}]},
        headers=as_user("jae@example.com"),
    )
    assert res.status_code == 404, res.text
    db.expire_all()
    assert [i.pin_id for i in db.query(PlanItem).filter(PlanItem.plan_id == proposal_id)] == [trip.pins["vase"].id]


# --- direct placement: forward hours, each stop once -----------------------------


def test_a_placement_has_to_end_after_it_starts(client, trip):
    res = client.post(
        f"/api/trips/{trip.id}/plans",
        json=block(start=900, end=780, items=[{"pin_id": trip.pins["vase"].id}]),
        headers=as_user("mei@example.com"),
    )
    assert res.status_code == 400, res.text


def test_a_placement_holds_each_stop_once(client, trip):
    vase = {"pin_id": trip.pins["vase"].id}
    res = client.post(
        f"/api/trips/{trip.id}/plans",
        json=block(start=600, end=900, items=[vase, vase]),
        headers=as_user("mei@example.com"),
    )
    assert res.status_code == 400, res.text


def test_a_placement_naming_a_missing_pin_is_a_404_not_a_500(client, trip):
    res = client.post(
        f"/api/trips/{trip.id}/plans",
        json=block(items=[{"pin_id": 999_999}]),
        headers=as_user("mei@example.com"),
    )
    assert res.status_code == 404, res.text


def test_moving_a_plan_so_it_ends_before_it_starts_is_refused(client, trip):
    plan = trip.place(start=780, end=840, pin="vase")
    res = client.patch(
        f"/api/plans/{plan.id}",
        json={"start_min": at(1, 900)},
        headers=as_user("mei@example.com"),
    )
    assert res.status_code == 400, res.text


def test_a_valid_placement_still_goes_through(client, trip):
    res = client.post(
        f"/api/trips/{trip.id}/plans",
        json=block(start=780, end=830, items=[{"pin_id": trip.pins["vase"].id}]),
        headers=as_user("mei@example.com"),
    )
    assert res.status_code == 201, res.text


# --- votes --------------------------------------------------------------------------


def _open(client, trip, *, start, end, pin):
    res = client.post(
        f"/api/trips/{trip.id}/contests",
        json=block(start=start, end=end, items=[{"pin_id": trip.pins[pin].id}]),
        headers=as_user("jae@example.com"),
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_a_vote_has_to_name_one_of_the_contests_own_options(client, trip, db):
    first = _open(client, trip, start=600, end=700, pin="vase")
    second = _open(client, trip, start=780, end=900, pin="tide")
    placed = trip.place(day=2, start=600, end=660, pin="ice")

    for foreign_plan_id in (second["plans"][-1]["id"], placed.id):
        res = client.post(
            f"/api/contests/{first['id']}/vote",
            json={"plan_id": foreign_plan_id},
            headers=as_user("ana@example.com"),
        )
        assert res.status_code == 404, res.text
    assert db.query(Vote).count() == 0

    own = client.post(
        f"/api/contests/{first['id']}/vote",
        json={"plan_id": first["plans"][-1]["id"]},
        headers=as_user("ana@example.com"),
    )
    assert own.status_code == 200, own.text
