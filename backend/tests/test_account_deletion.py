"""Deleting your own account — see app/routers/account.py."""

from datetime import datetime, timedelta, timezone

import pytest

from app import photo_storage
from app.models import Comment, Contributor, Pin, Plan, PlanStatus, Trip, Vote

from conftest import as_user

MEI = as_user("mei@example.com")  # owns the fixture trip
JAE = as_user("jae@example.com")  # planner on it


def _add_trip(db, name, members, created_offset_days=0):
    """A second trip. `members`: (email, name, role) in join order."""
    row = Trip(name=name, created_at=datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(days=created_offset_days))
    db.add(row)
    db.flush()
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for i, (email, display_name, role) in enumerate(members):
        db.add(
            Contributor(
                trip_id=row.id,
                email=email,
                display_name=display_name,
                initial=display_name[0],
                role=role,
                joined_at=base + timedelta(hours=i),
            )
        )
    db.commit()
    return row


@pytest.fixture
def deleted_photos(monkeypatch):
    calls = []
    monkeypatch.setattr(photo_storage, "delete_trip_photos", lambda trip_id: calls.append(trip_id))
    return calls


def test_preview_sorts_trips_by_what_happens_to_them(client, trip, db):
    solo = _add_trip(db, "Solo weekend", [("mei@example.com", "Mei", "owner")])
    theirs = _add_trip(db, "Jae's trip", [("jae@example.com", "Jae", "owner"), ("mei@example.com", "Mei", "planner")])

    res = client.get("/api/me/deletion-preview", headers=MEI)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["handed_over"] == [{"id": trip.id, "name": "Taiwan", "new_owner_name": "Jae"}]
    assert body["deleted"] == [{"id": solo.id, "name": "Solo weekend", "new_owner_name": None}]
    assert body["left"] == [{"id": theirs.id, "name": "Jae's trip", "new_owner_name": None}]


def test_preview_for_someone_with_no_trips(client):
    res = client.get("/api/me/deletion-preview", headers=as_user("new@example.com"))
    assert res.json() == {"handed_over": [], "deleted": [], "left": []}


def test_a_planner_takes_over_before_earlier_companions_and_readers(client, db):
    row = _add_trip(
        db,
        "Lisbon",
        [
            ("mei@example.com", "Mei", "owner"),
            ("rae@example.com", "Rae", "reader"),
            ("kai@example.com", "Kai", "companion"),
            ("jae@example.com", "Jae", "planner"),
            ("ana@example.com", "Ana", "planner"),
        ],
    )
    assert client.get("/api/me/deletion-preview", headers=MEI).json()["handed_over"][0]["new_owner_name"] == "Jae"

    assert client.delete("/api/me", headers=MEI).status_code == 204

    roles = {c.email: c.role for c in db.query(Contributor).filter(Contributor.trip_id == row.id)}
    assert roles == {
        "rae@example.com": "reader",
        "kai@example.com": "companion",
        "jae@example.com": "owner",
        "ana@example.com": "planner",
    }


def test_the_longest_standing_member_takes_over_when_there_is_no_planner(client, db):
    row = _add_trip(
        db,
        "Oslo",
        [
            ("mei@example.com", "Mei", "owner"),
            ("rae@example.com", "Rae", "reader"),
            ("kai@example.com", "Kai", "companion"),
            ("lin@example.com", "Lin", "companion"),
        ],
    )
    assert client.delete("/api/me", headers=MEI).status_code == 204
    owner = db.query(Contributor).filter(Contributor.trip_id == row.id, Contributor.role == "owner").one()
    assert owner.email == "kai@example.com"


def test_deleting_hands_over_owned_trips_and_keeps_what_you_added(client, trip, db, deleted_photos):
    trip.pins["vase"].added_by_id = trip.mei.id
    trip.pins["ice"].heads = [trip.mei.id, trip.jae.id]
    db.add(Comment(pin_id=trip.pins["vase"].id, contributor_id=trip.mei.id, body="must see"))
    db.commit()
    placed = trip.place(start=840, end=900, pin="tide", created_by="mei")
    draft = trip.place(day=2, start=600, end=660, pin="cave", created_by="mei", status=PlanStatus.draft)
    placed_id, draft_id, jae_id = placed.id, draft.id, trip.jae.id

    assert client.delete("/api/me", headers=MEI).status_code == 204

    db.expire_all()
    assert db.query(Contributor).filter(Contributor.email == "mei@example.com").count() == 0
    assert db.get(Contributor, jae_id).role == "owner"
    assert db.get(Trip, trip.id) is not None
    assert trip.pins["vase"].added_by_id is None
    assert trip.pins["ice"].heads == [jae_id]
    assert db.get(Plan, placed_id).created_by_id is None
    assert db.get(Plan, draft_id) is None
    assert db.query(Comment).count() == 0
    assert deleted_photos == []

    # The trip carries on under its new owner.
    res = client.get(f"/api/trips/{trip.id}", headers=JAE)
    assert res.status_code == 200
    assert res.json()["owner"]["display_name"] == "Jae"


def test_deleting_removes_trips_you_own_alone(client, db, deleted_photos):
    solo = _add_trip(db, "Solo weekend", [("mei@example.com", "Mei", "owner")])
    pin = Pin(
        trip_id=solo.id, title="Cabin", short="Cabin", place="Cabin", region="", duration_minutes=60, cost_cents=0
    )
    db.add(pin)
    db.commit()
    solo_id = solo.id

    assert client.delete("/api/me", headers=MEI).status_code == 204

    db.expire_all()
    assert db.get(Trip, solo_id) is None
    assert db.query(Pin).filter(Pin.trip_id == solo_id).count() == 0
    assert db.query(Contributor).filter(Contributor.trip_id == solo_id).count() == 0
    assert deleted_photos == [solo_id]


def test_deleting_leaves_other_peoples_trips(client, trip, db):
    theirs = _add_trip(db, "Jae's trip", [("jae@example.com", "Jae", "owner"), ("mei@example.com", "Mei", "planner")])

    assert client.delete("/api/me", headers=MEI).status_code == 204

    members = {c.email: c.role for c in db.query(Contributor).filter(Contributor.trip_id == theirs.id)}
    assert members == {"jae@example.com": "owner"}


def test_a_deleted_trip_takes_its_plans_and_comments_with_it(client, trip, db):
    # Everyone else leaves, so Mei owns the fixture trip alone.
    for key in ("jae", "ana", "lin"):
        assert client.post(f"/api/trips/{trip.id}/leave", headers=as_user(f"{key}@example.com")).status_code == 204
    a = trip.place(start=600, end=660, pin="tide", created_by="mei")
    trip_id = trip.id
    db.add(Comment(plan_id=a.id, contributor_id=trip.mei.id, body="ok"))
    db.commit()

    assert client.delete("/api/me", headers=MEI).status_code == 204

    db.expire_all()
    assert db.get(Trip, trip_id) is None
    assert db.query(Plan).count() == 0
    assert db.query(Comment).count() == 0
    assert db.query(Vote).count() == 0


def test_after_deleting_you_have_no_trips_and_can_start_over(client, trip):
    assert client.delete("/api/me", headers=MEI).status_code == 204
    assert client.get("/api/trips", headers=MEI).json() == []
    assert client.get(f"/api/trips/{trip.id}", headers=MEI).status_code == 403
    # Deleting again is harmless.
    assert client.delete("/api/me", headers=MEI).status_code == 204
