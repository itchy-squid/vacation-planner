"""Expenses: costs that aren't places — a park ticket, a rental car
(app/models.py Pin.kind "expense"). They're kept in Expenses, never on the
calendar, and a pass can get its holders into ideas it covers."""

from conftest import as_user, at

MEI = as_user("mei@example.com")


def _expense(client, trip, **fields):
    body = {"title": "Universal 5-day ticket", "place": "", "region": "", "kind": "expense", "expense_type": "pass", **fields}
    return client.post(f"/api/trips/{trip.id}/pins", json=body, headers=MEI)


def _plan_item(client, trip):
    return client.get(f"/api/trips/{trip.id}/plans", headers=MEI).json()[0]["items"][0]


def test_an_expense_says_what_it_is_and_who_it_is_for(client, trip):
    who = [trip.travelers["mei"].id, trip.travelers["jae"].id]
    res = _expense(client, trip, cost_cents=45000, cost_start_day=2, cost_end_day=6, traveler_ids=who, covers_pin_ids=[trip.pins["tide"].id])
    assert res.status_code == 201, res.text
    body = res.json()
    assert (body["kind"], body["expense_type"]) == ("expense", "pass")
    assert body["traveler_ids"] == who
    assert body["covers_pin_ids"] == [trip.pins["tide"].id]


def test_an_expense_needs_a_type(client, trip):
    res = client.post(f"/api/trips/{trip.id}/pins", json={"title": "Car", "place": "", "region": "", "kind": "expense"}, headers=MEI)
    assert res.status_code == 422


def test_only_expenses_have_expense_fields(client, trip):
    res = client.post(
        f"/api/trips/{trip.id}/pins",
        json={"title": "Park", "place": "Park", "region": "X", "traveler_ids": [trip.travelers["mei"].id]},
        headers=MEI,
    )
    assert res.status_code == 422
    patched = client.patch(f"/api/pins/{trip.pins['vase'].id}", json={"expense_type": "rental"}, headers=MEI)
    assert patched.status_code == 422


def test_only_a_pass_covers_ideas(client, trip):
    res = _expense(client, trip, expense_type="rental", covers_pin_ids=[trip.pins["tide"].id])
    assert res.status_code == 422
    car = _expense(client, trip, title="Rental car", expense_type="rental").json()
    assert client.patch(f"/api/pins/{car['id']}", json={"covers_pin_ids": [trip.pins["tide"].id]}, headers=MEI).status_code == 422


def test_a_pass_stops_covering_when_it_stops_being_a_pass(client, trip):
    ticket = _expense(client, trip, covers_pin_ids=[trip.pins["tide"].id]).json()
    other = client.patch(f"/api/pins/{ticket['id']}", json={"expense_type": "other"}, headers=MEI)
    assert other.status_code == 200, other.text
    assert other.json()["covers_pin_ids"] is None


def test_an_expense_is_for_travelers_on_the_trip(client, trip):
    assert _expense(client, trip, traveler_ids=[999999]).status_code == 422
    assert _expense(client, trip, traveler_ids=[]).status_code == 422


def test_a_pass_covers_places_to_go_on_the_trip(client, trip):
    stay = client.post(
        f"/api/trips/{trip.id}/pins", json={"title": "Hotel", "place": "Hotel", "region": "X", "kind": "stay"}, headers=MEI
    ).json()
    assert _expense(client, trip, covers_pin_ids=[stay["id"]]).status_code == 422
    assert _expense(client, trip, covers_pin_ids=[999999]).status_code == 422


def test_an_idea_and_an_expense_never_turn_into_each_other(client, trip):
    assert client.patch(f"/api/pins/{trip.pins['vase'].id}", json={"kind": "expense"}, headers=MEI).status_code == 422
    car = _expense(client, trip, title="Rental car", expense_type="rental").json()
    assert client.patch(f"/api/pins/{car['id']}", json={"kind": "activity"}, headers=MEI).status_code == 422


def test_an_expense_never_goes_on_the_plan(client, trip):
    car = _expense(client, trip, title="Rental car", expense_type="rental").json()
    body = {"start_min": at(2, 600), "end_min": at(2, 660), "items": [{"pin_id": car["id"]}]}
    res = client.post(f"/api/trips/{trip.id}/plans", json=body, headers=MEI)
    assert res.status_code == 422
    assert "expense" in res.json()["detail"]


def test_a_pass_holder_pays_nothing_for_a_covered_stop(client, trip):
    client.patch(f"/api/pins/{trip.pins['tide'].id}", json={"cost_basis": "per_head", "cost_cents": 13900}, headers=MEI)
    holders = [trip.travelers[k].id for k in ("mei", "jae", "ana")]
    _expense(client, trip, traveler_ids=holders, covers_pin_ids=[trip.pins["tide"].id])
    trip.place(day=2, start=540, end=960, pin="tide")
    item = _plan_item(client, trip)
    assert item["sharer_ids"] == [trip.travelers["lin"].id]
    assert (item["each_cents"], item["total_cents"]) == (13900, 13900)


def test_a_pass_covers_only_on_its_days(client, trip):
    client.patch(f"/api/pins/{trip.pins['tide'].id}", json={"cost_basis": "per_head", "cost_cents": 13900}, headers=MEI)
    _expense(client, trip, cost_start_day=2, cost_end_day=3, covers_pin_ids=[trip.pins["tide"].id])
    trip.place(day=4, start=540, end=960, pin="tide")
    item = _plan_item(client, trip)
    assert len(item["sharer_ids"]) == 4
    assert item["total_cents"] == 4 * 13900


def test_a_stop_everyone_holds_a_pass_for_costs_nothing(client, trip):
    _expense(client, trip, covers_pin_ids=[trip.pins["tide"].id])
    trip.place(day=2, start=540, end=960, pin="tide")
    item = _plan_item(client, trip)
    assert item["sharer_ids"] == []
    assert item["total_cents"] == 0


def test_deleting_a_covered_idea_takes_it_off_the_pass(client, trip):
    ticket = _expense(client, trip, covers_pin_ids=[trip.pins["tide"].id, trip.pins["cave"].id]).json()
    assert client.delete(f"/api/pins/{trip.pins['cave'].id}", headers=MEI).status_code == 204
    assert client.get(f"/api/pins/{ticket['id']}", headers=MEI).json()["covers_pin_ids"] == [trip.pins["tide"].id]
