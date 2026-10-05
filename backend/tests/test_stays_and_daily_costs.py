"""Stays (an idea that's somewhere to sleep, not something to do) and
prices paid by the day (app/models.py Pin.kind and Pin.cost_per)."""

from conftest import as_user, at

MEI = as_user("mei@example.com")


def _place(client, trip, pin_key):
    body = {
        "start_min": at(2, 600),
        "end_min": at(2, 660),
        "items": [{"pin_id": trip.pins[pin_key].id}],
    }
    return client.post(f"/api/trips/{trip.id}/plans", json=body, headers=MEI)


def test_ideas_are_activities_paid_once_unless_told_otherwise(client, trip):
    pin = client.get(f"/api/pins/{trip.pins['vase'].id}", headers=MEI).json()
    assert pin["kind"] == "activity"
    assert pin["cost_per"] == "once"
    assert pin["cost_start_day"] is None and pin["cost_end_day"] is None


def test_a_stay_can_be_added_and_changed_back(client, trip):
    created = client.post(
        f"/api/trips/{trip.id}/pins",
        json={"title": "Casa Malix", "place": "Casa Malix", "region": "Xiaoliuqiu", "kind": "stay", "cost_cents": 18000, "cost_basis": "group", "cost_per": "day"},
        headers=MEI,
    )
    assert created.status_code == 201, created.text
    assert created.json()["kind"] == "stay"
    assert created.json()["cost_per"] == "day"
    back = client.patch(f"/api/pins/{created.json()['id']}", json={"kind": "activity"}, headers=MEI)
    assert back.json()["kind"] == "activity"


def test_a_stay_never_goes_on_the_plan(client, trip):
    client.patch(f"/api/pins/{trip.pins['vase'].id}", json={"kind": "stay"}, headers=MEI)
    res = _place(client, trip, "vase")
    assert res.status_code == 422
    assert "Where we'll be" in res.json()["detail"]


def test_an_idea_on_the_plan_comes_off_before_it_becomes_a_stay(client, trip):
    trip.place(start=840, end=900, pin="tide")
    res = client.patch(f"/api/pins/{trip.pins['tide'].id}", json={"kind": "stay"}, headers=MEI)
    assert res.status_code == 409
    assert client.get(f"/api/pins/{trip.pins['tide'].id}", headers=MEI).json()["kind"] == "activity"


def test_the_days_of_a_daily_price_come_together_and_run_forwards(client, trip):
    url = f"/api/pins/{trip.pins['vase'].id}"
    assert client.patch(url, json={"cost_start_day": 1}, headers=MEI).status_code == 422
    assert client.patch(url, json={"cost_start_day": 4, "cost_end_day": 1}, headers=MEI).status_code == 422
    ok = client.patch(url, json={"cost_per": "day", "cost_start_day": 1, "cost_end_day": 4}, headers=MEI)
    assert ok.status_code == 200, ok.text
    assert (ok.json()["cost_start_day"], ok.json()["cost_end_day"]) == (1, 4)
    cleared = client.patch(url, json={"cost_start_day": None, "cost_end_day": None}, headers=MEI)
    assert cleared.json()["cost_start_day"] is None


def test_a_stop_for_something_paid_by_the_day_costs_nothing_on_its_plan(client, trip):
    """Its days are counted once for the whole trip (frontend lib/
    dailyCosts.js), so a placement — a rental car's pick-up — mustn't
    count it again."""
    client.patch(f"/api/pins/{trip.pins['ice'].id}", json={"cost_per": "day"}, headers=MEI)
    trip.place(start=840, end=900, pin="ice")
    plan = client.get(f"/api/trips/{trip.id}/plans", headers=MEI).json()[0]
    assert plan["total_cost_cents"] == 0
    assert plan["items"][0]["total_cents"] == 0
    assert plan["items"][0]["pin"]["cost_cents"] == 400
