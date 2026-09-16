"""Custom events (travel items) don't outlive the plans holding them.

Removing one from the calendar, discarding the draft it was made in,
forgetting the other sets when one is picked, or dropping it from a set deletes it
rather than leaving it in the unplaced list — unless another plan still
uses it. Pins keep the old behaviour and go back to the tray. See
app/custom_events.py.
"""

from app.models import Pin, TravelItem

from conftest import as_user, at


def new_event(client, trip, title="Scooter hire", user="jae"):
    res = client.post(
        f"/api/trips/{trip.id}/travel-items",
        json={"title": title, "kind": "other", "duration_minutes": 60, "cost_cents": 0},
        headers=as_user(f"{user}@example.com"),
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def travel_ids(client, trip):
    return {t["id"] for t in client.get(f"/api/trips/{trip.id}/travel-items").json()}


def test_unplacing_a_custom_event_deletes_it(client, trip, db):
    plan = trip.place(start=480, end=555, travel_item="ferry")
    ferry_id = trip.travel_items["ferry"].id

    res = client.delete(f"/api/plans/{plan.id}", headers=as_user("mei@example.com"))
    assert res.status_code == 204

    assert ferry_id not in travel_ids(client, trip)


def test_unplacing_a_pin_still_leaves_it_in_the_tray(client, trip, db):
    plan = trip.place(start=480, end=555, pin="vase")
    vase_id = trip.pins["vase"].id

    assert client.delete(f"/api/plans/{plan.id}", headers=as_user("mei@example.com")).status_code == 204

    db.expire_all()
    assert db.get(Pin, vase_id) is not None


def test_a_custom_event_used_by_another_plan_survives(client, trip, db):
    ferry_id = trip.travel_items["ferry"].id
    placed = trip.place(start=480, end=555, travel_item="ferry")
    # Someone's draft elsewhere still holds it.
    res = client.post(
        f"/api/trips/{trip.id}/plans",
        json={
            "starts_at": at(2, 600).isoformat(),
            "ends_at": at(2, 720).isoformat(),
            "status": "draft",
            "items": [{"travel_item_id": ferry_id}],
        },
        headers=as_user("jae@example.com"),
    )
    assert res.status_code == 201, res.text

    assert client.delete(f"/api/plans/{placed.id}", headers=as_user("mei@example.com")).status_code == 204

    db.expire_all()
    assert db.get(TravelItem, ferry_id) is not None


def test_discarding_a_draft_deletes_the_custom_events_made_in_it(client, trip):
    event_id = new_event(client, trip)
    draft = client.post(
        f"/api/trips/{trip.id}/plans",
        json={
            "starts_at": at(1, 780).isoformat(),
            "ends_at": at(1, 1080).isoformat(),
            "status": "draft",
            "items": [{"pin_id": trip.pins["vase"].id}, {"travel_item_id": event_id}],
        },
        headers=as_user("jae@example.com"),
    ).json()

    res = client.delete(f"/api/plans/{draft['id']}", headers=as_user("jae@example.com"))
    assert res.status_code == 204

    assert event_id not in travel_ids(client, trip)


def test_picking_forgets_the_custom_events_only_the_losing_sets_used(client, trip):
    trip.place(start=840, end=900, pin="tide")
    event_id = new_event(client, trip)
    res = client.post(
        f"/api/trips/{trip.id}/contests",
        json={
            "starts_at": at(1, 780).isoformat(),
            "ends_at": at(1, 1080).isoformat(),
            "items": [{"pin_id": trip.pins["vase"].id}, {"travel_item_id": event_id}],
        },
        headers=as_user("jae@example.com"),
    )
    assert res.status_code == 201, res.text
    contest_id, incumbent_id = res.json()["id"], res.json()["plans"][0]["id"]

    res = client.post(
        f"/api/contests/{contest_id}/pick",
        json={"plan_id": incumbent_id},
        headers=as_user("mei@example.com"),
    )
    assert res.status_code == 200, res.text

    assert event_id not in travel_ids(client, trip)


def test_picking_the_set_with_the_custom_event_keeps_it(client, trip):
    trip.place(start=840, end=900, pin="tide")
    event_id = new_event(client, trip)
    res = client.post(
        f"/api/trips/{trip.id}/contests",
        json={
            "starts_at": at(1, 780).isoformat(),
            "ends_at": at(1, 1080).isoformat(),
            "items": [{"travel_item_id": event_id}],
        },
        headers=as_user("jae@example.com"),
    )
    contest_id, proposal_id = res.json()["id"], res.json()["plans"][1]["id"]

    res = client.post(
        f"/api/contests/{contest_id}/pick",
        json={"plan_id": proposal_id},
        headers=as_user("mei@example.com"),
    )
    assert res.status_code == 200, res.text

    assert event_id in travel_ids(client, trip)


def test_dropping_a_custom_event_from_a_set_deletes_it(client, trip):
    trip.place(start=840, end=900, pin="tide")
    event_id = new_event(client, trip)
    res = client.post(
        f"/api/trips/{trip.id}/contests",
        json={
            "starts_at": at(1, 780).isoformat(),
            "ends_at": at(1, 1080).isoformat(),
            "items": [{"pin_id": trip.pins["vase"].id}, {"travel_item_id": event_id}],
        },
        headers=as_user("jae@example.com"),
    )
    proposal_id = res.json()["plans"][1]["id"]

    res = client.put(
        f"/api/plans/{proposal_id}/stops",
        json={"label": "", "rationale": "", "items": [{"pin_id": trip.pins["vase"].id}]},
        headers=as_user("jae@example.com"),
    )
    assert res.status_code == 200, res.text

    assert event_id not in travel_ids(client, trip)
