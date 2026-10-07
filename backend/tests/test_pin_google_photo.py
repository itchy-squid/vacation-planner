"""A pin's photo can be one of its Google place's own photos
(models.py Pin.photo_google_index, routers/pins.py _settle_photo). Only
which photo it is gets stored, never the image or Google's name for it, so
it's tied to the place: it needs one, and it goes when the place changes."""

import pytest

from conftest import as_user

JAE = as_user("jae@example.com")  # planner

BEAUTY_CAVE = {"title": "Beauty Cave", "place": "Liuqiu", "region": "Xiaoliuqiu"}
FOUND_AT = {"lat": 22.3398, "lng": 120.3697, "google_place_id": "ChIJbeauty-cave"}
LINK_PHOTO = {"photo_url": "https://example.com/cave.jpg", "photo_source_url": "https://example.com/cave"}


def create(client, trip, body):
    return client.post(f"/api/trips/{trip.id}/pins", json=body, headers=JAE)


def patch(client, pin_id, body):
    return client.patch(f"/api/pins/{pin_id}", json=body, headers=JAE)


def photo(pin):
    return {key: pin[key] for key in ("photo_url", "photo_source_url", "photo_google_index")}


def test_a_searched_pin_can_be_added_with_a_google_photo(client, trip):
    res = create(client, trip, {**BEAUTY_CAVE, **FOUND_AT, "photo_google_index": 2})
    assert res.status_code == 201, res.text
    assert photo(res.json()) == {"photo_url": None, "photo_source_url": None, "photo_google_index": 2}


@pytest.mark.parametrize(
    "body",
    [
        {**BEAUTY_CAVE, "photo_google_index": 0},
        {**BEAUTY_CAVE, **FOUND_AT, **LINK_PHOTO, "photo_google_index": 0},
        {**BEAUTY_CAVE, **FOUND_AT, "photo_google_index": 10},
        {**BEAUTY_CAVE, **FOUND_AT, "photo_google_index": -1},
    ],
)
def test_a_google_photo_needs_a_place_and_no_other_photo(client, trip, body):
    assert create(client, trip, body).status_code == 422


def test_picking_a_google_photo_replaces_a_link_photo(client, trip):
    pin = create(client, trip, {**BEAUTY_CAVE, **FOUND_AT, **LINK_PHOTO}).json()
    res = patch(client, pin["id"], {"photo_google_index": 1})
    assert res.status_code == 200, res.text
    assert photo(res.json()) == {"photo_url": None, "photo_source_url": None, "photo_google_index": 1}


def test_picking_a_link_photo_replaces_a_google_photo(client, trip):
    pin = create(client, trip, {**BEAUTY_CAVE, **FOUND_AT, "photo_google_index": 1}).json()
    res = patch(client, pin["id"], LINK_PHOTO)
    assert photo(res.json()) == {**LINK_PHOTO, "photo_google_index": None}


def test_no_photo_clears_a_google_photo(client, trip):
    pin = create(client, trip, {**BEAUTY_CAVE, **FOUND_AT, "photo_google_index": 1}).json()
    res = patch(client, pin["id"], {"photo_url": None, "photo_source_url": None, "photo_google_index": None})
    assert photo(res.json()) == {"photo_url": None, "photo_source_url": None, "photo_google_index": None}


def test_other_edits_keep_the_google_photo(client, trip):
    pin = create(client, trip, {**BEAUTY_CAVE, **FOUND_AT, "photo_google_index": 1}).json()
    assert patch(client, pin["id"], {"title": "The Beauty Cave"}).json()["photo_google_index"] == 1


@pytest.mark.parametrize(
    "move",
    [
        {"lat": 22.34, "lng": 120.37},  # placed by hand: no longer the place
        {**FOUND_AT, "google_place_id": "ChIJsomewhere-else"},  # matched to another place
        {"lat": None, "lng": None},  # spot removed
    ],
)
def test_a_google_photo_goes_with_its_place(client, trip, move):
    pin = create(client, trip, {**BEAUTY_CAVE, **FOUND_AT, "photo_google_index": 1}).json()
    res = patch(client, pin["id"], move)
    assert res.status_code == 200, res.text
    assert res.json()["photo_google_index"] is None


def test_a_new_place_can_come_with_its_own_google_photo(client, trip):
    pin = create(client, trip, {**BEAUTY_CAVE, **FOUND_AT, "photo_google_index": 1}).json()
    res = patch(client, pin["id"], {**FOUND_AT, "google_place_id": "ChIJsomewhere-else", "photo_google_index": 3})
    assert res.json()["photo_google_index"] == 3


def test_a_google_photo_is_refused_on_a_pin_without_a_place(client, trip):
    pin = create(client, trip, BEAUTY_CAVE).json()
    assert patch(client, pin["id"], {"photo_google_index": 0}).status_code == 422
