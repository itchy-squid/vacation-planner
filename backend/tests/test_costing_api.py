"""The two fields the Expenses screen is built on.

Expenses itself is derived entirely on the client from the plans it
already has (feature spec §2) — there is no expenses endpoint. What the
API has to carry is `heads` on each pin/travel item and `traveller_count`
on the trip.
"""

from conftest import as_user


def test_a_pin_starts_shared_by_everyone(client, trip):
    pins = client.get(f"/api/trips/{trip.id}/pins").json()
    assert all(p["heads"] == [] for p in pins)


def test_heads_can_be_narrowed_to_a_subset(client, trip):
    res = client.patch(
        f"/api/pins/{trip.pins['ice'].id}",
        json={"heads": [trip.ana.id, trip.mei.id]},
    )
    assert res.status_code == 200, res.text
    assert res.json()["heads"] == [trip.ana.id, trip.mei.id]
    # And back to everyone.
    assert client.patch(f"/api/pins/{trip.pins['ice'].id}", json={"heads": []}).json()["heads"] == []


def test_a_travel_item_carries_heads_too(client, trip):
    res = client.patch(
        f"/api/travel-items/{trip.travel_items['ferry'].id}",
        json={"heads": [trip.jae.id]},
    )
    assert res.status_code == 200, res.text
    assert res.json()["heads"] == [trip.jae.id]


def test_traveler_count_is_the_roster(client, trip):
    """Who's going is the traveler roster (app/models.py Traveler), not
    a number typed into trip settings."""
    body = client.get(f"/api/trips/{trip.id}").json()
    assert body["traveler_count"] == 4
    assert body["my_traveler_id"] == trip.travelers["mei"].id
    client.post(f"/api/trips/{trip.id}/travelers", json={"name": "Kai"})
    assert client.get(f"/api/trips/{trip.id}").json()["traveler_count"] == 5


def test_scheduled_items_carry_their_cost_and_heads_through_the_plan(client, trip):
    """The Expenses screen reads rows straight off the plans it already
    fetched, so everything it needs has to travel with the plan."""
    client.patch(f"/api/pins/{trip.pins['ice'].id}", json={"heads": [trip.ana.id]})
    trip.place(start=840, end=1080, items=[("ice", None)])

    plan = client.get(f"/api/trips/{trip.id}/plans", headers=as_user("mei@example.com")).json()[0]
    item = plan["items"][0]
    assert item["pin"]["cost_cents"] == 400
    assert item["pin"]["heads"] == [trip.ana.id]
    assert item["start_minute_of_day"] == 840
