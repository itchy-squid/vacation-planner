"""Comments on a day of the trip (routers/comments.py, app/models.py Comment).

A day comment is on the whole day, stored by day of the trip like the places
for a day, so it moves with the trip's dates. Anyone on the trip reads them,
anyone who can comment writes them, and only the author changes or deletes
one.
"""

from datetime import timedelta

import pytest

from conftest import TRIP_DAY_ONE, as_user

MEI = as_user("mei@example.com")  # owner
JAE = as_user("jae@example.com")  # planner
ANA = as_user("ana@example.com")  # made a companion below
RAE = as_user("rae@example.com")  # reader, added below
SAM = as_user("sam@example.com")  # not on the trip


@pytest.fixture
def trip(trip, db):
    """The shared fixture trip, five days long."""
    trip.trip.end_date = TRIP_DAY_ONE + timedelta(days=4)
    db.commit()
    return trip


def post(client, trip, day, body, headers=MEI):
    return client.post(f"/api/trips/{trip.id}/comments", json={"day": day, "body": body}, headers=headers)


def listed(client, trip, headers=MEI):
    res = client.get(f"/api/trips/{trip.id}/day-comments", headers=headers)
    assert res.status_code == 200
    return res.json()


def test_a_comment_on_a_day_comes_back_with_who_wrote_it(client, trip):
    res = post(client, trip, 3, "  Bring cash for the boat.  ")
    assert res.status_code == 201
    body = res.json()
    assert body["day"] == 3
    assert body["body"] == "Bring cash for the boat."
    assert body["contributor_id"] == trip.mei.id
    assert body["pin_id"] is None and body["plan_id"] is None
    assert body["edited_at"] is None
    assert [c["id"] for c in listed(client, trip)] == [body["id"]]


def test_comments_come_back_by_day_then_oldest_first(client, trip):
    post(client, trip, 4, "Check out by 11")
    first = post(client, trip, 2, "Rent the car the night before").json()["id"]
    second = post(client, trip, 2, "I'll book it", headers=JAE).json()["id"]
    assert [(c["day"], c["body"]) for c in listed(client, trip)] == [
        (2, "Rent the car the night before"),
        (2, "I'll book it"),
        (4, "Check out by 11"),
    ]
    assert first < second


def test_only_the_trips_own_days_can_be_commented_on(client, trip):
    assert post(client, trip, 0, "Before the trip").status_code == 422
    assert post(client, trip, 6, "After the trip").status_code == 422
    assert post(client, trip, 5, "Last day").status_code == 201


def test_a_trip_with_no_days_has_nothing_to_comment_on(client, trip, db):
    trip.trip.start_date = None
    trip.trip.end_date = None
    trip.trip.length_days = None
    db.commit()
    assert post(client, trip, 1, "Hello").status_code == 422


def test_an_empty_comment_is_refused(client, trip):
    assert post(client, trip, 1, "   ").status_code == 422
    assert listed(client, trip) == []


def test_a_comment_is_on_one_thing(client, trip):
    res = client.post(
        f"/api/trips/{trip.id}/comments",
        json={"day": 1, "pin_id": trip.pins["vase"].id, "body": "Both?"},
        headers=MEI,
    )
    assert res.status_code == 422


def test_comments_on_ideas_arent_day_comments(client, trip):
    client.post(f"/api/trips/{trip.id}/comments", json={"pin_id": trip.pins["vase"].id, "body": "Go at low tide"}, headers=MEI)
    assert listed(client, trip) == []


def test_the_author_can_change_their_comment(client, trip):
    cid = post(client, trip, 1, "Ferry at 7:40").json()["id"]
    res = client.patch(f"/api/trips/{trip.id}/comments/{cid}", json={"body": "Ferry at 8:10"}, headers=MEI)
    assert res.status_code == 200
    assert res.json()["body"] == "Ferry at 8:10"
    assert res.json()["edited_at"] is not None
    assert listed(client, trip)[0]["body"] == "Ferry at 8:10"


def test_the_author_can_delete_their_comment(client, trip):
    cid = post(client, trip, 1, "Ferry at 7:40").json()["id"]
    assert client.delete(f"/api/trips/{trip.id}/comments/{cid}", headers=MEI).status_code == 204
    assert listed(client, trip) == []


def test_nobody_else_can_change_or_delete_it_not_even_the_owner(client, trip):
    cid = post(client, trip, 1, "Mine", headers=JAE).json()["id"]
    assert client.patch(f"/api/trips/{trip.id}/comments/{cid}", json={"body": "Yours"}, headers=MEI).status_code == 403
    assert client.delete(f"/api/trips/{trip.id}/comments/{cid}", headers=MEI).status_code == 403
    assert listed(client, trip)[0]["body"] == "Mine"


def test_a_comment_on_another_trip_isnt_found(client, trip, db):
    from app.models import Contributor, Trip

    other = Trip(name="Elsewhere", region_line="", start_date=TRIP_DAY_ONE)
    db.add(other)
    db.flush()
    db.add(Contributor(trip_id=other.id, email="mei@example.com", display_name="Mei", initial="M", is_owner=True))
    db.commit()
    cid = post(client, trip, 1, "On the first trip").json()["id"]
    assert client.patch(f"/api/trips/{other.id}/comments/{cid}", json={"body": "x"}, headers=MEI).status_code == 404
    assert client.delete(f"/api/trips/{other.id}/comments/{cid}", headers=MEI).status_code == 404


def test_companions_comment_and_readers_only_read(client, trip, db):
    from app.models import Contributor

    trip.ana.role = "companion"
    db.add(Contributor(trip_id=trip.id, email="rae@example.com", display_name="Rae", initial="R", role="reader"))
    db.commit()
    assert post(client, trip, 1, "Count me in", headers=ANA).status_code == 201
    assert post(client, trip, 1, "Me too", headers=RAE).status_code == 403
    assert [c["body"] for c in listed(client, trip, headers=RAE)] == ["Count me in"]


def test_someone_off_the_trip_can_do_neither(client, trip):
    assert client.get(f"/api/trips/{trip.id}/day-comments", headers=SAM).status_code in (403, 404)
    assert post(client, trip, 1, "Hi", headers=SAM).status_code in (403, 404)


def test_keep_dates_keeps_comments_on_their_date(client, trip):
    """Day 1 moves two days later, so a comment on day 4 (Oct 6) is now on day 2."""
    post(client, trip, 4, "Oct 6")
    res = client.patch(
        f"/api/trips/{trip.id}",
        json={"start_date": "2026-10-05", "end_date": "2026-10-09", "move": "keep_dates"},
        headers=MEI,
    )
    assert res.status_code == 200
    assert listed(client, trip)[0]["day"] == 2


def test_a_day_comment_alone_asks_before_the_dates_move(client, trip):
    post(client, trip, 1, "Hello")
    res = client.patch(f"/api/trips/{trip.id}", json={"start_date": "2026-10-04", "end_date": "2026-10-08"}, headers=MEI)
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "move_required"


def test_deleting_the_trip_deletes_its_day_comments(client, trip, db):
    from app.models import Comment

    post(client, trip, 1, "Hello")
    db.delete(trip.trip)
    db.commit()
    assert db.query(Comment).count() == 0
