"""The two fields the Expenses screen is built on.

Expenses itself is derived entirely on the client from the plans it
already has (feature spec §2) — there is no expenses endpoint. What the
API has to carry is each scheduled stop's money on the plan and the
traveler roster on the trip.
"""

from conftest import as_user


def test_ideas_carry_no_cost_split_of_their_own(client, trip):
    """Who shares a cost is who's on the plan it's scheduled in
    (app/derive.py item_money), never something set on the idea itself."""
    pins = client.get(f"/api/trips/{trip.id}/pins").json()
    items = client.get(f"/api/trips/{trip.id}/travel-items").json()
    assert pins and items
    assert all("heads" not in row for row in pins + items)


def test_traveler_count_is_the_roster(client, trip):
    """Who's going is the traveler roster (app/models.py Traveler), not
    a number typed into trip settings."""
    body = client.get(f"/api/trips/{trip.id}").json()
    assert body["traveler_count"] == 4
    assert body["my_traveler_id"] == trip.travelers["mei"].id
    client.post(f"/api/trips/{trip.id}/travelers", json={"name": "Kai"})
    assert client.get(f"/api/trips/{trip.id}").json()["traveler_count"] == 5


def test_scheduled_items_carry_their_cost_and_sharers_through_the_plan(client, trip):
    """The Expenses screen reads rows straight off the plans it already
    fetched, so everything it needs has to travel with the plan."""
    trip.place(start=840, end=1080, items=[("ice", None)])

    plan = client.get(f"/api/trips/{trip.id}/plans", headers=as_user("mei@example.com")).json()[0]
    item = plan["items"][0]
    assert item["pin"]["cost_cents"] == 400
    assert item["sharer_ids"] == sorted(t.id for t in trip.travelers.values())
    assert item["start_minute_of_day"] == 840
