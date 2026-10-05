"""Planning by day of the trip (app/tripdays.py): trips with a length
instead of dates, and what happens to the calendar when the dates move.
"""

from datetime import date

from app.models import AvailabilityOverride, AvailabilityRule, Contest, Pin, Plan, Split, Trip, TripDayPlace
from conftest import as_user, at

MEI = as_user("mei@example.com")  # owner
JAE = as_user("jae@example.com")  # planner


def create(client, **body):
    res = client.post("/api/trips", json={"name": "Kyoto", **body}, headers=MEI)
    assert res.status_code == 201, res.text
    return res.json()


def patch(client, trip_id, headers=MEI, **body):
    return client.patch(f"/api/trips/{trip_id}", json=body, headers=headers)


# ---- trips without dates ----


def test_a_trip_can_be_made_with_a_length_and_a_month(client):
    trip = create(client, length_days=5, rough_month=3)
    assert (trip["start_date"], trip["end_date"]) == (None, None)
    assert (trip["length_days"], trip["rough_month"], trip["day_count"]) == (5, 3, 5)


def test_dates_win_over_a_length(client):
    trip = create(client, start_date="2027-03-12", end_date="2027-03-16", length_days=9, rough_month=7)
    assert (trip["length_days"], trip["rough_month"], trip["day_count"]) == (None, None, 5)


def test_a_trip_with_neither_has_no_days(client):
    assert create(client)["day_count"] is None


def test_a_bad_length_or_month_is_refused(client):
    for body in ({"length_days": 0}, {"length_days": 400}, {"rough_month": 13}):
        assert client.post("/api/trips", json={"name": "Kyoto", **body}, headers=MEI).status_code == 422


def test_a_trip_cant_end_before_it_starts(client):
    res = client.post("/api/trips", json={"name": "Kyoto", "start_date": "2027-03-12", "end_date": "2027-03-11"}, headers=MEI)
    assert res.status_code == 422
    trip = create(client, start_date="2027-03-12", end_date="2027-03-16")
    assert patch(client, trip["id"], end_date="2027-03-01").status_code == 422


def test_a_trip_without_dates_is_planned_on_its_days(client):
    trip = create(client, length_days=3)
    res = client.put(f"/api/trips/{trip['id']}/day-places", json={"days": [{"day": 3, "stay": "Kyoto"}]}, headers=MEI)
    assert res.status_code == 200, res.text
    plan = client.post(f"/api/trips/{trip['id']}/plans", json={"start_min": at(2, 540), "end_min": at(2, 600), "items": []}, headers=MEI)
    assert plan.status_code == 201, plan.text
    assert plan.json()["start_min"] == at(2, 540)


def test_setting_dates_keeps_everything_on_its_day(client, db):
    trip = create(client, length_days=3, rough_month=3)
    client.post(f"/api/trips/{trip['id']}/plans", json={"start_min": at(2, 540), "end_min": at(2, 600), "items": []}, headers=MEI)
    res = patch(client, trip["id"], start_date="2027-03-12", end_date="2027-03-14")
    assert res.status_code == 200, res.text
    assert (res.json()["length_days"], res.json()["rough_month"], res.json()["day_count"]) == (None, None, 3)
    assert db.query(Plan).one().start_min == at(2, 540)


def test_dropping_the_dates_keeps_the_days(client, db):
    trip = create(client, start_date="2027-03-12", end_date="2027-03-16")
    client.post(f"/api/trips/{trip['id']}/plans", json={"start_min": at(4, 540), "end_min": at(4, 600), "items": []}, headers=MEI)
    res = patch(client, trip["id"], start_date=None, end_date=None, length_days=5)
    assert res.status_code == 200, res.text
    assert (res.json()["day_count"], res.json()["length_days"]) == (5, 5)
    assert db.query(Plan).one().start_min == at(4, 540)


# ---- moving the dates ----


def test_moving_the_start_with_nothing_planned_needs_no_choice(client, trip):
    res = patch(client, trip.id, start_date="2026-10-10", end_date="2026-10-14")
    assert res.status_code == 200, res.text


def test_moving_the_start_with_a_plan_asks_which_way(client, trip, db):
    trip.place(day=2, start=540, end=600, pin="vase")
    res = patch(client, trip.id, start_date="2026-10-10", end_date="2026-10-14")
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "move_required"
    assert res.json()["detail"]["days"] == 7
    db.expire_all()
    assert db.get(Trip, trip.id).start_date == date(2026, 10, 3)


def test_moving_only_the_end_never_asks(client, trip):
    trip.place(day=2, start=540, end=600, pin="vase")
    assert patch(client, trip.id, end_date="2026-10-20").status_code == 200


def test_shift_moves_the_plan_with_the_trip(client, trip, db):
    plan = trip.place(day=2, start=540, end=600, pin="vase")
    res = patch(client, trip.id, start_date="2026-10-10", end_date="2026-10-14", move="shift")
    assert res.status_code == 200, res.text
    db.expire_all()
    assert db.get(Plan, plan.id).start_min == at(2, 540)


def test_keep_dates_leaves_everything_on_its_date(client, trip, db):
    """Day 1 moves two days later (Oct 3 -> Oct 5), so what was on day 4
    (Oct 6) is on day 2 now, and day 1 (Oct 3) is before the trip."""
    early = trip.place(day=1, start=540, end=600, pin="vase")
    late = trip.place(day=4, start=540, end=600, pin="ice")
    (branch, *_) = trip.split(("ana",), ("jae",), day=4, start=900, end=960)
    trip.trip.end_date = date(2026, 10, 8)
    db.add(TripDayPlace(trip_id=trip.id, day=4, name="Kenting", name_key="kenting", kind="stay", position=0))
    db.add(TripDayPlace(trip_id=trip.id, day=5, name="Kenting", name_key="kenting", kind="stay", position=0))
    car = trip.pins["tide"]
    car.cost_start_day, car.cost_end_day = 3, 5
    vase = trip.pins["vase"]
    db.add(AvailabilityRule(pin_id=vase.id, days=[3, 4], bands=["AM"]))
    db.add(AvailabilityOverride(pin_id=vase.id, day=4, band="PM"))
    db.commit()

    res = patch(client, trip.id, start_date="2026-10-05", end_date="2026-10-10", move="keep_dates")
    assert res.status_code == 200, res.text
    db.expire_all()
    assert db.get(Plan, early.id).start_min == at(-1, 540)
    assert db.get(Plan, late.id).start_min == at(2, 540)
    assert db.get(Split, branch.split_id).start_min == at(2, 900)
    assert sorted(p.day for p in db.query(TripDayPlace)) == [2, 3]
    assert (db.get(Pin, car.id).cost_start_day, db.get(Pin, car.id).cost_end_day) == (1, 3)
    assert db.query(AvailabilityRule).one().days == [1, 2]
    assert db.query(AvailabilityOverride).one().day == 2


def test_keep_dates_moved_back_puts_everything_where_it_was(client, trip, db):
    plan = trip.place(day=3, start=540, end=600, pin="vase")
    db.add(TripDayPlace(trip_id=trip.id, day=1, name="Taipei", name_key="taipei", kind="stay", position=0))
    db.add(TripDayPlace(trip_id=trip.id, day=2, name="Taipei", name_key="taipei", kind="stay", position=0))
    db.commit()
    assert patch(client, trip.id, start_date="2026-10-04", move="keep_dates").status_code == 200
    assert patch(client, trip.id, start_date="2026-10-03", move="keep_dates").status_code == 200
    db.expire_all()
    assert db.get(Plan, plan.id).start_min == at(3, 540)
    assert sorted(p.day for p in db.query(TripDayPlace)) == [1, 2]


def test_keep_dates_moves_contests_too(client, trip, db):
    res = client.post(
        f"/api/trips/{trip.id}/contests",
        json={"start_min": at(2, 780), "end_min": at(2, 900), "items": [{"pin_id": trip.pins["vase"].id}]},
        headers=JAE,
    )
    assert res.status_code == 201, res.text
    assert patch(client, trip.id, start_date="2026-10-04", move="keep_dates").status_code == 200
    db.expire_all()
    contest = db.query(Contest).one()
    assert (contest.start_min, contest.end_min) == (at(1, 780), at(1, 900))
    assert {p.start_min for p in contest.plans} == {at(1, 780)}


def test_only_the_owner_moves_the_dates(client, trip):
    assert patch(client, trip.id, headers=JAE, start_date="2026-10-04", move="shift").status_code == 403
