"""The photo on a trip's card (app/routers/trips.py cover_photo_url): one of
its places to stay or longer activities, else any idea's photo."""

from app.models import Pin
from conftest import as_user

MEI = as_user("mei@example.com")


def create(client):
    res = client.post("/api/trips", json={"name": "Kyoto"}, headers=MEI)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def add_pin(db, trip_id, title, photo, kind="activity", minutes=60):
    db.add(Pin(trip_id=trip_id, title=title, place=title, region="Kyoto", kind=kind, duration_minutes=minutes, photo_url=photo))
    db.commit()


def cover(client, trip_id):
    trips = client.get("/api/trips", headers=MEI).json()
    return next(t for t in trips if t["id"] == trip_id)["cover_photo_url"]


def test_no_photos_no_cover(client, db):
    trip_id = create(client)
    add_pin(db, trip_id, "Ryokan", None, kind="stay")
    assert cover(client, trip_id) is None


def test_a_stay_or_long_activity_is_preferred_over_a_short_one(client, db):
    trip_id = create(client)
    add_pin(db, trip_id, "Coffee", "https://img/coffee.jpg", minutes=30)
    add_pin(db, trip_id, "Ryokan", "https://img/ryokan.jpg", kind="stay")
    add_pin(db, trip_id, "Hike", "https://img/hike.jpg", minutes=240)
    add_pin(db, trip_id, "Shrine", "https://img/shrine.jpg", minutes=90)
    assert cover(client, trip_id) in {"https://img/ryokan.jpg", "https://img/hike.jpg"}


def test_any_photo_when_nothing_long_has_one(client, db):
    trip_id = create(client)
    add_pin(db, trip_id, "Ryokan", None, kind="stay")
    add_pin(db, trip_id, "Coffee", "https://img/coffee.jpg", minutes=30)
    assert cover(client, trip_id) == "https://img/coffee.jpg"


def test_the_cover_holds_still_between_visits(client, db):
    trip_id = create(client)
    for i in range(6):
        add_pin(db, trip_id, f"Stay {i}", f"https://img/{i}.jpg", kind="stay")
    first = cover(client, trip_id)
    assert all(cover(client, trip_id) == first for _ in range(5))
