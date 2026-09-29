"""Rides planned from the Map tab's trip builder (frontend lib/tripPlan.js).

A ride is a travel item that says how it goes (`mode`) and how far
(`distance_meters`). A trip whose stops are all on the calendar already
puts its rides straight on the calendar; one with a new stop is proposed
as one block of stops and rides, and a stop already on the calendar in the
middle of it keeps its time inside the block — captured into "on the
board", so losing the vote leaves it where it was.
"""

import pytest

from conftest import as_user, at

JAE = as_user("jae@example.com")


def ride(client, trip, **fields):
    body = {"title": "Bus to Geban Bay", "kind": "travel", "duration_minutes": 25, "mode": "bus", "distance_meters": 6400}
    return client.post(f"/api/trips/{trip.id}/travel-items", json={**body, **fields}, headers=JAE)


def test_a_ride_keeps_its_mode_and_distance(client, trip):
    res = ride(client, trip)
    assert res.status_code == 201, res.text
    listed = client.get(f"/api/trips/{trip.id}/travel-items", headers=JAE).json()
    saved = next(t for t in listed if t["id"] == res.json()["id"])
    assert (saved["kind"], saved["mode"], saved["distance_meters"]) == ("travel", "bus", 6400)


def test_items_typed_in_by_hand_have_no_mode(client, trip):
    res = client.post(f"/api/trips/{trip.id}/travel-items", json={"title": "Scooter hire"}, headers=JAE)
    assert (res.json()["mode"], res.json()["distance_meters"]) == (None, None)


@pytest.mark.parametrize("fields", [{"mode": "ferry"}, {"kind": "other"}, {"kind": "lodging"}, {"distance_meters": -1}])
def test_a_mode_is_one_of_four_and_only_on_travel(client, trip, fields):
    assert ride(client, trip, **fields).status_code == 422


def test_a_mode_cant_be_patched_onto_something_else(client, trip):
    item_id = trip.travel_items["ferry"].id  # kind "other"
    assert client.patch(f"/api/travel-items/{item_id}", json={"mode": "car"}, headers=JAE).status_code == 422
    res = client.patch(f"/api/travel-items/{item_id}", json={"kind": "travel", "mode": "car"}, headers=JAE)
    assert res.status_code == 200, res.text
    assert res.json()["mode"] == "car"


def test_a_ride_that_stops_being_travel_forgets_how_it_went(client, trip):
    item_id = ride(client, trip).json()["id"]
    res = client.patch(f"/api/travel-items/{item_id}", json={"kind": "other"}, headers=JAE)
    assert res.status_code == 200, res.text
    assert (res.json()["mode"], res.json()["distance_meters"]) == (None, None)


def test_a_ride_goes_straight_onto_the_calendar_between_two_plans(client, trip):
    """Every stop already on the calendar: the ride fills the gap."""
    trip.place(start=540, end=600, pin="vase")
    trip.place(start=630, end=700, pin="beach")
    ride_id = ride(client, trip).json()["id"]

    res = client.post(
        f"/api/trips/{trip.id}/plans",
        json={
            "starts_at": at(1, 600).isoformat(),
            "ends_at": at(1, 625).isoformat(),
            "status": "placed",
            "items": [{"travel_item_id": ride_id}],
        },
        headers=JAE,
    )
    assert res.status_code == 201, res.text
    item = res.json()["items"][0]["travel_item"]
    assert (item["mode"], item["title"]) == ("bus", "Bus to Geban Bay")


def test_a_trip_proposal_keeps_a_stop_already_on_the_calendar_at_its_time(client, trip):
    """Hotel → ride → Vase Rock (new) → ride → tide pools (placed 11:00)
    → ride → Hotel. The block runs from the first ride to the last; the
    placed stop sits inside it at 11:00 and is captured as set A."""
    trip.place(start=660, end=730, pin="tide")
    rides = [ride(client, trip, title=f"Ride {n}", duration_minutes=20).json()["id"] for n in range(3)]

    # 09:30 ride · 09:50 Vase Rock (50m) · 10:40 ride · 11:00 tide pools
    # (70m) · 12:10 ride, ending 12:30.
    items = [
        {"travel_item_id": rides[0], "offset_minutes": 0},
        {"pin_id": trip.pins["vase"].id, "offset_minutes": 20},
        {"travel_item_id": rides[1], "offset_minutes": 70},
        {"pin_id": trip.pins["tide"].id, "offset_minutes": 90},
        {"travel_item_id": rides[2], "offset_minutes": 160},
    ]
    res = client.post(
        f"/api/trips/{trip.id}/contests",
        json={"starts_at": at(1, 570).isoformat(), "ends_at": at(1, 750).isoformat(), "label": "Vase Rock", "items": items},
        headers=JAE,
    )
    assert res.status_code == 201, res.text
    on_board, proposal = res.json()["plans"]

    assert [i["pin"]["title"] for i in on_board["items"]] == ["Meirendong tide pools"]
    assert on_board["items"][0]["start_minute_of_day"] == 660
    starts = [(i["start_minute_of_day"], (i["pin"] or i["travel_item"])["title"]) for i in proposal["items"]]
    assert starts == [(570, "Ride 0"), (590, "Vase Rock"), (640, "Ride 1"), (660, "Meirendong tide pools"), (730, "Ride 2")]


def test_rides_in_a_losing_proposal_are_forgotten(client, trip, db):
    """Rides are custom events: nothing to go back to once their plan is
    gone (app/custom_events.py), so discarding a draft trip deletes them."""
    from app.models import TravelItem

    ride_id = ride(client, trip).json()["id"]
    draft = client.post(
        f"/api/trips/{trip.id}/plans",
        json={
            "starts_at": at(2, 600).isoformat(),
            "ends_at": at(2, 675).isoformat(),
            "status": "draft",
            "items": [{"travel_item_id": ride_id}, {"pin_id": trip.pins["vase"].id}],
        },
        headers=JAE,
    ).json()
    assert client.delete(f"/api/plans/{draft['id']}", headers=JAE).status_code == 204
    db.expire_all()
    assert db.get(TravelItem, ride_id) is None
