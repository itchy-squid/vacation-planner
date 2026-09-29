"""Where we'll be: the places for each day of a trip (routers/day_places.py,
app/models.py TripDayPlace).

A day has at most one place it's staying in and any number of day trips,
in order. A PUT replaces whole days, and a day with nothing is cleared.
"""

from datetime import timedelta

import pytest

from conftest import TRIP_DAY_ONE, as_user

MEI = as_user("mei@example.com")  # owner
JAE = as_user("jae@example.com")  # planner
ANA = as_user("ana@example.com")  # made a companion below
RAE = as_user("rae@example.com")  # reader, added below
SAM = as_user("sam@example.com")  # not on the trip

DAY_ONE = TRIP_DAY_ONE.date()


def day(n: int) -> str:
    return (DAY_ONE + timedelta(days=n - 1)).isoformat()


@pytest.fixture
def trip(trip, db):
    """The shared fixture trip, five days long."""
    trip.trip.end_date = DAY_ONE + timedelta(days=4)
    db.commit()
    return trip


def put(client, trip, days, headers=JAE):
    return client.put(f"/api/trips/{trip.id}/day-places", json={"days": days}, headers=headers)


def places(client, trip, headers=MEI):
    res = client.get(f"/api/trips/{trip.id}/day-places", headers=headers)
    assert res.status_code == 200
    return res.json()


def test_a_trip_starts_with_no_days_set(client, trip):
    assert places(client, trip) == []


def test_a_stay_and_day_trips_come_back_in_order(client, trip):
    res = put(client, trip, [{"date": day(3), "stay": "Taipei", "visits": ["North Coast", "Jiufen"]}])
    assert res.status_code == 200
    expected = [{"date": day(3), "stay": "Taipei", "visits": ["North Coast", "Jiufen"]}]
    assert res.json() == expected
    assert places(client, trip) == expected


def test_a_day_can_have_day_trips_without_a_stay(client, trip):
    put(client, trip, [{"date": day(2), "visits": ["Xiaoliuqiu"]}])
    assert places(client, trip) == [{"date": day(2), "stay": None, "visits": ["Xiaoliuqiu"]}]


def test_setting_several_days_at_once_sorts_them_by_date(client, trip):
    put(client, trip, [{"date": day(2), "stay": "Kaohsiung"}, {"date": day(1), "stay": "Kaohsiung"}])
    assert [d["date"] for d in places(client, trip)] == [day(1), day(2)]


def test_putting_a_day_replaces_it_and_leaves_other_days_alone(client, trip):
    put(client, trip, [{"date": day(1), "stay": "Taipei"}, {"date": day(2), "stay": "Taipei", "visits": ["Jiufen"]}])
    put(client, trip, [{"date": day(2), "stay": "Hualien", "visits": ["Taroko Gorge"]}])
    assert places(client, trip) == [
        {"date": day(1), "stay": "Taipei", "visits": []},
        {"date": day(2), "stay": "Hualien", "visits": ["Taroko Gorge"]},
    ]


def test_a_day_with_nothing_is_cleared(client, trip):
    put(client, trip, [{"date": day(1), "stay": "Taipei"}, {"date": day(2), "stay": "Taipei"}])
    put(client, trip, [{"date": day(1), "stay": None, "visits": []}])
    assert [d["date"] for d in places(client, trip)] == [day(2)]


def test_putting_the_old_days_back_undoes_a_clear(client, trip):
    before = [{"date": day(1), "stay": "Taipei", "visits": ["North Coast"]}, {"date": day(2), "stay": "Hualien", "visits": []}]
    put(client, trip, before)
    put(client, trip, [{"date": day(1)}, {"date": day(2)}])
    assert places(client, trip) == []
    put(client, trip, before)
    assert places(client, trip) == before


def test_names_are_trimmed(client, trip):
    put(client, trip, [{"date": day(1), "stay": "  Taipei ", "visits": [" Jiufen"]}])
    assert places(client, trip) == [{"date": day(1), "stay": "Taipei", "visits": ["Jiufen"]}]


@pytest.mark.parametrize(
    "bad_day",
    [
        {"date": day(1), "stay": "Taipei", "visits": ["taipei"]},
        {"date": day(1), "visits": ["Jiufen", "JIUFEN"]},
        {"date": day(1), "stay": "   "},
        {"date": day(1), "visits": [""]},
        {"date": day(1), "stay": "x" * 121},
        {"date": day(1), "visits": [f"Place {n}" for n in range(13)]},
        {"date": "not a date", "stay": "Taipei"},
    ],
    ids=["day-trip-to-the-stay", "same-day-trip-twice", "blank-stay", "blank-day-trip", "long-name", "too-many-day-trips", "bad-date"],
)
def test_a_bad_day_is_refused(client, trip, bad_day):
    assert put(client, trip, [bad_day]).status_code == 422
    assert places(client, trip) == []


def test_the_same_date_twice_is_refused(client, trip):
    res = put(client, trip, [{"date": day(1), "stay": "Taipei"}, {"date": day(1), "stay": "Hualien"}])
    assert res.status_code == 422


def test_an_empty_update_is_refused(client, trip):
    assert put(client, trip, []).status_code == 422


@pytest.mark.parametrize("outside", [DAY_ONE - timedelta(days=1), DAY_ONE + timedelta(days=5)], ids=["before", "after"])
def test_only_the_trips_own_dates_can_be_set(client, trip, outside):
    res = put(client, trip, [{"date": day(1), "stay": "Taipei"}, {"date": outside.isoformat(), "stay": "Taipei"}])
    assert res.status_code == 422
    assert outside.isoformat() in res.json()["detail"]
    assert places(client, trip) == []


def test_a_trip_without_dates_has_no_days_to_set(client, trip, db):
    trip.trip.start_date = None
    trip.trip.end_date = None
    db.commit()
    res = put(client, trip, [{"date": day(1), "stay": "Taipei"}])
    assert res.status_code == 422
    assert "dates" in res.json()["detail"]


def test_a_one_day_trip_with_no_end_date_has_its_start_date(client, trip, db):
    trip.trip.end_date = None
    db.commit()
    assert put(client, trip, [{"date": day(1), "stay": "Taipei"}]).status_code == 200
    assert put(client, trip, [{"date": day(2), "stay": "Taipei"}]).status_code == 422


def test_places_outside_changed_trip_dates_are_kept(client, trip, db):
    put(client, trip, [{"date": day(5), "stay": "Taipei"}])
    trip.trip.end_date = DAY_ONE + timedelta(days=1)
    db.commit()
    assert places(client, trip) == [{"date": day(5), "stay": "Taipei", "visits": []}]


def test_companions_and_readers_see_the_places_but_cant_change_them(client, trip, db):
    from app.models import Contributor

    trip.ana.role = "companion"
    db.add(Contributor(trip_id=trip.id, email="rae@example.com", display_name="Rae", initial="R", role="reader"))
    db.commit()
    put(client, trip, [{"date": day(1), "stay": "Taipei"}], headers=MEI)

    for who in (ANA, RAE):
        assert places(client, trip, headers=who) == [{"date": day(1), "stay": "Taipei", "visits": []}]
        assert put(client, trip, [{"date": day(1), "stay": "Hualien"}], headers=who).status_code == 403
    assert places(client, trip)[0]["stay"] == "Taipei"


def test_someone_off_the_trip_can_do_neither(client, trip):
    assert client.get(f"/api/trips/{trip.id}/day-places", headers=SAM).status_code in (403, 404)
    assert put(client, trip, [{"date": day(1), "stay": "Taipei"}], headers=SAM).status_code in (403, 404)


def test_deleting_the_trip_deletes_its_places(client, trip, db):
    from app.models import TripDayPlace

    put(client, trip, [{"date": day(1), "stay": "Taipei", "visits": ["Jiufen"]}])
    db.delete(trip.trip)
    db.commit()
    assert db.query(TripDayPlace).count() == 0
