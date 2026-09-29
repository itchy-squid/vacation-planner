"""Adding a pin from a place search (routers/pins.py create_pin,
schemas.py _check_location).

A pin found by searching arrives with its coordinates and Google place ID.
The location is all or nothing: lat and lng together, and a place ID only
alongside the coordinates it was found at. Pins added from a link or by
name still have none.
"""

import pytest

from conftest import as_user

MEI = as_user("mei@example.com")  # owner
JAE = as_user("jae@example.com")  # planner

BEAUTY_CAVE = {"title": "Beauty Cave", "place": "Liuqiu", "region": "Xiaoliuqiu"}
FOUND_AT = {"lat": 22.3398, "lng": 120.3697, "google_place_id": "ChIJbeauty-cave"}


def create(client, trip, body):
    return client.post(f"/api/trips/{trip.id}/pins", json=body, headers=JAE)


def location(body):
    return {key: body[key] for key in ("lat", "lng", "google_place_id")}


def test_a_searched_pin_keeps_where_it_was_found(client, trip):
    res = create(client, trip, {**BEAUTY_CAVE, **FOUND_AT})
    assert res.status_code == 201
    assert location(res.json()) == FOUND_AT

    listed = client.get(f"/api/trips/{trip.id}/pins", headers=MEI).json()
    assert location(next(p for p in listed if p["id"] == res.json()["id"])) == FOUND_AT


def test_a_pin_added_by_name_has_no_location(client, trip):
    res = create(client, trip, BEAUTY_CAVE)
    assert res.status_code == 201
    assert location(res.json()) == {"lat": None, "lng": None, "google_place_id": None}


def test_a_location_without_a_place_id_is_fine(client, trip):
    res = create(client, trip, {**BEAUTY_CAVE, "lat": 22.3398, "lng": 120.3697})
    assert res.status_code == 201
    assert location(res.json()) == {"lat": 22.3398, "lng": 120.3697, "google_place_id": None}


@pytest.mark.parametrize(
    "extra",
    [
        {"lat": 22.3},
        {"lng": 120.3},
        {"google_place_id": "ChIJbeauty-cave"},
        {"lat": 91, "lng": 120.3},
        {"lat": 22.3, "lng": -181},
        {"lat": 22.3, "lng": 120.3, "google_place_id": ""},
    ],
    ids=["lat-alone", "lng-alone", "place-id-alone", "lat-out-of-range", "lng-out-of-range", "empty-place-id"],
)
def test_half_a_location_is_refused(client, trip, extra):
    before = len(client.get(f"/api/trips/{trip.id}/pins", headers=MEI).json())
    assert create(client, trip, {**BEAUTY_CAVE, **extra}).status_code == 422
    assert len(client.get(f"/api/trips/{trip.id}/pins", headers=MEI).json()) == before


# ---- An exact spot set later (the Map tab's "Pin a spot") ----

def patch(client, pin_id, body, headers=JAE):
    return client.patch(f"/api/pins/{pin_id}", json=body, headers=headers)


def test_a_spot_can_be_pinned_later_without_a_place_id(client, trip):
    vase = trip.pins["vase"]
    res = patch(client, vase.id, {"lat": 22.34, "lng": 120.37})
    assert res.status_code == 200
    assert location(res.json()) == {"lat": 22.34, "lng": 120.37, "google_place_id": None}


def test_moving_a_searched_pin_by_hand_drops_its_place_id(client, trip):
    pin = create(client, trip, {**BEAUTY_CAVE, **FOUND_AT}).json()
    res = patch(client, pin["id"], {"lat": 22.35, "lng": 120.38})
    assert location(res.json()) == {"lat": 22.35, "lng": 120.38, "google_place_id": None}


def test_other_edits_leave_the_spot_alone(client, trip):
    pin = create(client, trip, {**BEAUTY_CAVE, **FOUND_AT}).json()
    res = patch(client, pin["id"], {"title": "Beauty Cave at dusk"})
    assert location(res.json()) == FOUND_AT


def test_clearing_the_spot_clears_all_of_it(client, trip):
    pin = create(client, trip, {**BEAUTY_CAVE, **FOUND_AT}).json()
    res = patch(client, pin["id"], {"lat": None, "lng": None})
    assert location(res.json()) == {"lat": None, "lng": None, "google_place_id": None}


@pytest.mark.parametrize(
    "body",
    [{"lat": 22.3}, {"lng": 120.3}, {"lat": None}, {"lat": 22.3, "lng": None}, {"google_place_id": "ChIJx"}],
    ids=["lat-alone", "lng-alone", "lat-null-alone", "lng-null", "place-id-alone"],
)
def test_half_a_spot_is_refused_on_update(client, trip, body):
    pin = create(client, trip, {**BEAUTY_CAVE, **FOUND_AT}).json()
    assert patch(client, pin["id"], body).status_code == 422
    assert location(client.get(f"/api/pins/{pin['id']}", headers=MEI).json()) == FOUND_AT
