"""Hearting ideas on the board (app/models.py PinHeart, routers/pins.py).

A heart is one person's "I'd like to do this". Anyone who may vote may
heart; the count sorts ideas by popularity when placing or proposing.
"""

import pytest

from app import photo_storage
from app.models import Contributor, PinHeart

from conftest import as_user

MEI = as_user("mei@example.com")  # owner
JAE = as_user("jae@example.com")  # planner
KAI = as_user("kai@example.com")  # companion, added below
RAE = as_user("rae@example.com")  # reader, added below
SAM = as_user("sam@example.com")  # not on the trip


@pytest.fixture
def companion(trip, db):
    kai = Contributor(trip_id=trip.id, email="kai@example.com", display_name="Kai", initial="K", role="companion")
    db.add(kai)
    db.commit()
    return kai


@pytest.fixture
def reader(trip, db):
    rae = Contributor(trip_id=trip.id, email="rae@example.com", display_name="Rae", initial="R", role="reader")
    db.add(rae)
    db.commit()
    return rae


def heart(client, pin, headers):
    return client.put(f"/api/pins/{pin.id}/heart", headers=headers)


def unheart(client, pin, headers):
    return client.delete(f"/api/pins/{pin.id}/heart", headers=headers)


def hearted_by(client, trip, key):
    pins = client.get(f"/api/trips/{trip.id}/pins", headers=MEI).json()
    return next(p for p in pins if p["id"] == trip.pins[key].id)["hearted_by"]


def test_a_new_pin_has_no_hearts(client, trip):
    assert hearted_by(client, trip, "vase") == []


def test_hearting_returns_the_pin_with_everyone_who_hearted_it_in_order(client, trip, companion):
    vase = trip.pins["vase"]
    assert heart(client, vase, JAE).json()["hearted_by"] == [trip.jae.id]

    res = heart(client, vase, KAI)
    assert res.status_code == 200
    assert res.json()["hearted_by"] == [trip.jae.id, companion.id]
    assert hearted_by(client, trip, "vase") == [trip.jae.id, companion.id]
    # Only that pin.
    assert hearted_by(client, trip, "tide") == []


def test_hearting_twice_is_one_heart(client, trip):
    vase = trip.pins["vase"]
    heart(client, vase, JAE)
    assert heart(client, vase, JAE).json()["hearted_by"] == [trip.jae.id]


def test_unhearting_takes_only_your_heart_back_and_repeating_it_is_harmless(client, trip):
    vase = trip.pins["vase"]
    heart(client, vase, JAE)
    heart(client, vase, MEI)

    assert unheart(client, vase, JAE).json()["hearted_by"] == [trip.mei.id]
    res = unheart(client, vase, JAE)
    assert res.status_code == 200
    assert res.json()["hearted_by"] == [trip.mei.id]


def test_a_placed_pin_carries_its_hearts_onto_the_calendar(client, trip):
    heart(client, trip.pins["tide"], JAE)
    trip.place(start=840, end=900, pin="tide")

    plans = client.get(f"/api/trips/{trip.id}/plans", headers=MEI).json()
    assert plans[0]["items"][0]["pin"]["hearted_by"] == [trip.jae.id]


def test_readers_and_outsiders_cannot_heart(client, trip, reader):
    vase = trip.pins["vase"]
    res = heart(client, vase, RAE)
    assert res.status_code == 403
    assert res.json()["detail"]["missing_scope"] == "votes:write"
    assert unheart(client, vase, RAE).status_code == 403
    assert heart(client, vase, SAM).status_code in (403, 404)
    # But a reader sees the hearts.
    heart(client, vase, JAE)
    pins = client.get(f"/api/trips/{trip.id}/pins", headers=RAE).json()
    assert next(p for p in pins if p["id"] == vase.id)["hearted_by"] == [trip.jae.id]


def test_hearting_a_missing_pin_is_404(client, trip):
    assert client.put("/api/pins/999999/heart", headers=MEI).status_code == 404


def test_deleting_a_hearted_pin_takes_its_hearts_with_it(client, trip, db):
    vase_id = trip.pins["vase"].id
    heart(client, trip.pins["vase"], JAE)
    assert client.delete(f"/api/pins/{vase_id}", headers=MEI).status_code == 204
    db.expire_all()
    assert db.query(PinHeart).filter_by(pin_id=vase_id).count() == 0


def test_demoting_to_reader_clears_their_hearts_but_to_planner_does_not(client, trip, companion, db):
    heart(client, trip.pins["vase"], KAI)

    assert client.patch(f"/api/trips/{trip.id}/contributors/{companion.id}", json={"role": "planner"}, headers=MEI).status_code == 200
    assert hearted_by(client, trip, "vase") == [companion.id]

    assert client.patch(f"/api/trips/{trip.id}/contributors/{companion.id}", json={"role": "reader"}, headers=MEI).status_code == 200
    assert hearted_by(client, trip, "vase") == []


def test_leaving_the_trip_takes_your_hearts_with_you(client, trip, db):
    heart(client, trip.pins["vase"], JAE)
    heart(client, trip.pins["vase"], MEI)

    assert client.post(f"/api/trips/{trip.id}/leave", headers=JAE).status_code == 204
    assert hearted_by(client, trip, "vase") == [trip.mei.id]


def test_deleting_your_account_deletes_hearts_on_trips_you_owned_alone(client, trip, db, monkeypatch):
    monkeypatch.setattr(photo_storage, "delete_trip_photos", lambda trip_id: None)
    # Everyone else leaves, so Mei owns the trip alone and it goes with her.
    heart(client, trip.pins["vase"], MEI)
    heart(client, trip.pins["vase"], JAE)
    for who in ("jae", "ana", "lin"):
        assert client.post(f"/api/trips/{trip.id}/leave", headers=as_user(f"{who}@example.com")).status_code == 204

    assert client.delete("/api/me", headers=MEI).status_code == 204
    db.expire_all()
    assert db.query(PinHeart).count() == 0
