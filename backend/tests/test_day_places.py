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

DAY_ONE = TRIP_DAY_ONE


def day(n: int) -> int:
    return n


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
    res = put(client, trip, [{"day": day(3), "stay": "Taipei", "visits": ["North Coast", "Jiufen"]}])
    assert res.status_code == 200
    expected = [{"day": day(3), "stay": "Taipei", "lodging_pin_id": None, "visits": ["North Coast", "Jiufen"]}]
    assert res.json() == expected
    assert places(client, trip) == expected


def test_a_day_can_have_day_trips_without_a_stay(client, trip):
    put(client, trip, [{"day": day(2), "visits": ["Xiaoliuqiu"]}])
    assert places(client, trip) == [{"day": day(2), "stay": None, "lodging_pin_id": None, "visits": ["Xiaoliuqiu"]}]


def test_setting_several_days_at_once_sorts_them_by_day(client, trip):
    put(client, trip, [{"day": day(2), "stay": "Kaohsiung"}, {"day": day(1), "stay": "Kaohsiung"}])
    assert [d["day"] for d in places(client, trip)] == [day(1), day(2)]


def test_putting_a_day_replaces_it_and_leaves_other_days_alone(client, trip):
    put(client, trip, [{"day": day(1), "stay": "Taipei"}, {"day": day(2), "stay": "Taipei", "visits": ["Jiufen"]}])
    put(client, trip, [{"day": day(2), "stay": "Hualien", "visits": ["Taroko Gorge"]}])
    assert places(client, trip) == [
        {"day": day(1), "stay": "Taipei", "lodging_pin_id": None, "visits": []},
        {"day": day(2), "stay": "Hualien", "lodging_pin_id": None, "visits": ["Taroko Gorge"]},
    ]


def test_a_day_with_nothing_is_cleared(client, trip):
    put(client, trip, [{"day": day(1), "stay": "Taipei"}, {"day": day(2), "stay": "Taipei"}])
    put(client, trip, [{"day": day(1), "stay": None, "visits": []}])
    assert [d["day"] for d in places(client, trip)] == [day(2)]


def test_putting_the_old_days_back_undoes_a_clear(client, trip):
    before = [{"day": day(1), "stay": "Taipei", "lodging_pin_id": None, "visits": ["North Coast"]}, {"day": day(2), "stay": "Hualien", "lodging_pin_id": None, "visits": []}]
    put(client, trip, before)
    put(client, trip, [{"day": day(1)}, {"day": day(2)}])
    assert places(client, trip) == []
    put(client, trip, before)
    assert places(client, trip) == before


def test_names_are_trimmed(client, trip):
    put(client, trip, [{"day": day(1), "stay": "  Taipei ", "visits": [" Jiufen"]}])
    assert places(client, trip) == [{"day": day(1), "stay": "Taipei", "lodging_pin_id": None, "visits": ["Jiufen"]}]


@pytest.mark.parametrize(
    "bad_day",
    [
        {"day": day(1), "stay": "Taipei", "visits": ["taipei"]},
        {"day": day(1), "visits": ["Jiufen", "JIUFEN"]},
        {"day": day(1), "stay": "   "},
        {"day": day(1), "visits": [""]},
        {"day": day(1), "stay": "x" * 121},
        {"day": day(1), "visits": [f"Place {n}" for n in range(13)]},
        {"day": "not a day", "stay": "Taipei"},
    ],
    ids=["day-trip-to-the-stay", "same-day-trip-twice", "blank-stay", "blank-day-trip", "long-name", "too-many-day-trips", "bad-day"],
)
def test_a_bad_day_is_refused(client, trip, bad_day):
    assert put(client, trip, [bad_day]).status_code == 422
    assert places(client, trip) == []


def test_the_same_day_twice_is_refused(client, trip):
    res = put(client, trip, [{"day": day(1), "stay": "Taipei"}, {"day": day(1), "stay": "Hualien"}])
    assert res.status_code == 422


def test_an_empty_update_is_refused(client, trip):
    assert put(client, trip, []).status_code == 422


@pytest.mark.parametrize("outside", [0, 6], ids=["before", "after"])
def test_only_the_trips_own_days_can_be_set(client, trip, outside):
    res = put(client, trip, [{"day": day(1), "stay": "Taipei"}, {"day": outside, "stay": "Taipei"}])
    assert res.status_code == 422
    assert f"Day {outside}" in res.json()["detail"]
    assert places(client, trip) == []


def test_places_outside_the_trip_can_be_cleared(client, trip, db):
    put(client, trip, [{"day": day(5), "stay": "Taipei"}])
    trip.trip.end_date = DAY_ONE + timedelta(days=1)
    db.commit()
    assert put(client, trip, [{"day": day(5), "stay": "Hualien"}]).status_code == 422
    assert put(client, trip, [{"day": day(5)}]).status_code == 200
    assert places(client, trip) == []


def test_a_trip_without_dates_or_a_length_has_no_days_to_set(client, trip, db):
    trip.trip.start_date = None
    trip.trip.end_date = None
    db.commit()
    res = put(client, trip, [{"day": day(1), "stay": "Taipei"}])
    assert res.status_code == 422
    assert "dates" in res.json()["detail"]


def test_a_trip_planned_by_length_has_that_many_days(client, trip, db):
    trip.trip.start_date = None
    trip.trip.end_date = None
    trip.trip.length_days = 3
    db.commit()
    assert put(client, trip, [{"day": day(3), "stay": "Taipei"}]).status_code == 200
    assert put(client, trip, [{"day": day(4), "stay": "Taipei"}]).status_code == 422


def test_a_one_day_trip_with_no_end_date_has_its_start_date(client, trip, db):
    trip.trip.end_date = None
    db.commit()
    assert put(client, trip, [{"day": day(1), "stay": "Taipei"}]).status_code == 200
    assert put(client, trip, [{"day": day(2), "stay": "Taipei"}]).status_code == 422


def test_places_outside_a_shortened_trip_are_kept(client, trip, db):
    put(client, trip, [{"day": day(5), "stay": "Taipei"}])
    trip.trip.end_date = DAY_ONE + timedelta(days=1)
    db.commit()
    assert places(client, trip) == [{"day": day(5), "stay": "Taipei", "lodging_pin_id": None, "visits": []}]


def test_companions_and_readers_see_the_places_but_cant_change_them(client, trip, db):
    from app.models import Contributor

    trip.ana.role = "companion"
    db.add(Contributor(trip_id=trip.id, email="rae@example.com", display_name="Rae", initial="R", role="reader"))
    db.commit()
    put(client, trip, [{"day": day(1), "stay": "Taipei"}], headers=MEI)

    for who in (ANA, RAE):
        assert places(client, trip, headers=who) == [{"day": day(1), "stay": "Taipei", "lodging_pin_id": None, "visits": []}]
        assert put(client, trip, [{"day": day(1), "stay": "Hualien"}], headers=who).status_code == 403
    assert places(client, trip)[0]["stay"] == "Taipei"


def test_someone_off_the_trip_can_do_neither(client, trip):
    assert client.get(f"/api/trips/{trip.id}/day-places", headers=SAM).status_code in (403, 404)
    assert put(client, trip, [{"day": day(1), "stay": "Taipei"}], headers=SAM).status_code in (403, 404)


def test_deleting_the_trip_deletes_its_places(client, trip, db):
    from app.models import TripDayPlace

    put(client, trip, [{"day": day(1), "stay": "Taipei", "visits": ["Jiufen"]}])
    db.delete(trip.trip)
    db.commit()
    assert db.query(TripDayPlace).count() == 0


# ---- Where the group is staying (the lodging idea) ----


@pytest.fixture
def hotel(trip, db):
    """An idea with an exact spot, the kind a day can be staying at."""
    pin = trip.pins["beach"]
    pin.lat, pin.lng = 22.3398, 120.3697
    db.commit()
    return pin


def test_a_stay_can_name_the_idea_the_group_is_staying_at(client, trip, hotel):
    res = put(client, trip, [{"day": day(2), "stay": "Xiaoliuqiu", "lodging_pin_id": hotel.id}])
    assert res.status_code == 200, res.text
    assert places(client, trip) == [{"day": day(2), "stay": "Xiaoliuqiu", "lodging_pin_id": hotel.id, "visits": []}]


def test_a_place_to_stay_at_needs_a_stay(client, trip, hotel):
    assert put(client, trip, [{"day": day(2), "lodging_pin_id": hotel.id}]).status_code == 422


def test_a_place_to_stay_at_needs_an_exact_spot(client, trip):
    res = put(client, trip, [{"day": day(2), "stay": "Xiaoliuqiu", "lodging_pin_id": trip.pins["vase"].id}])
    assert res.status_code == 422
    assert "Vase Rock" in res.json()["detail"]


def test_a_place_to_stay_at_must_be_on_this_trip(client, trip, hotel, db):
    from app.models import Pin, Trip

    other = Trip(name="Elsewhere")
    db.add(other)
    db.flush()
    stranger = Pin(trip_id=other.id, title="Their hotel", place="", region="", lat=1.0, lng=2.0)
    db.add(stranger)
    db.commit()
    res = put(client, trip, [{"day": day(2), "stay": "Xiaoliuqiu", "lodging_pin_id": stranger.id}])
    assert res.status_code == 422
    assert places(client, trip) == []


def test_deleting_the_idea_keeps_the_stay_but_forgets_the_place(client, trip, hotel):
    put(client, trip, [{"day": day(2), "stay": "Xiaoliuqiu", "lodging_pin_id": hotel.id}])
    assert client.delete(f"/api/pins/{hotel.id}", headers=MEI).status_code == 204
    assert places(client, trip) == [{"day": day(2), "stay": "Xiaoliuqiu", "lodging_pin_id": None, "visits": []}]
