"""Plans that cross midnight.

start_min/end_min count minutes from 00:00 on the trip's first day
(app/tripdays.py), so a plan that runs past midnight is just one whose
end is past the next multiple of 1440, and every overlap check is a plain
comparison. These tests pin the server half of that contract;
frontend/src/lib/planTime.js and lib/dayGrid.js carry the client half.
"""

from conftest import at


def _plan(client, trip, start_min, end_min, *, item=None, status="placed"):
    return client.post(
        f"/api/trips/{trip.id}/plans",
        json={
            "start_min": start_min,
            "end_min": end_min,
            "status": status,
            "items": [item or {"travel_item_id": trip.travel_items["ferry"].id}],
        },
    )


def test_an_overnight_plan_is_accepted(client, trip):
    res = _plan(client, trip, at(5, 1320), at(6, 600))
    assert res.status_code in (200, 201), res.text
    body = res.json()
    assert body["start_min"] == at(5, 1320)
    assert body["end_min"] == at(6, 600)


def test_slack_is_measured_across_the_date_boundary(client, trip):
    """A 12h window holding a 75m ferry has 645m of slack — not the 10h a
    within-one-day `% 1440` reading of the same span would produce."""
    res = _plan(client, trip, at(5, 1320), at(6, 600))
    body = res.json()
    assert body["total_duration_minutes"] == 75
    assert body["slack_minutes"] == 12 * 60 - 75


def test_the_next_morning_is_occupied(client, trip):
    """The hours after midnight belong to the plan that started the night
    before. This is what the day grid was blind to: it filtered plans by
    their *start* day, so it offered these hours as free and then took a
    409 from a plan the user could not see."""
    assert _plan(client, trip, at(5, 1320), at(6, 600)).status_code in (200, 201)

    clash = _plan(
        client, trip,
        at(6, 480), at(6, 540),
        item={"pin_id": trip.pins["ice"].id},
    )
    assert clash.status_code == 409, clash.text
    assert "occupying_plan_id" in clash.json()["detail"]


def test_touching_the_boundary_is_not_a_clash(client, trip):
    """Same rule as everywhere else: a shared minute conflicts, a shared
    edge does not — midnight is not special."""
    assert _plan(client, trip, at(5, 1320), at(6, 0)).status_code in (200, 201)
    res = _plan(
        client, trip,
        at(6, 0), at(6, 60),
        item={"pin_id": trip.pins["ice"].id},
    )
    assert res.status_code in (200, 201), res.text


def test_a_plan_can_be_moved_across_midnight(client, trip):
    created = _plan(client, trip, at(5, 840), at(5, 960)).json()
    res = client.patch(
        f"/api/plans/{created['id']}",
        json={"start_min": at(5, 1380), "end_min": at(6, 180)},
    )
    assert res.status_code == 200, res.text
    assert res.json()["end_min"] == at(6, 180)


def test_a_multi_night_span_is_held_whole(client, trip):
    """36 hours. The client's old duration maths wrapped this to 12h; the
    server never did, so a stay is storable and these are the hours it
    actually occupies."""
    assert _plan(client, trip, at(5, 1200), at(7, 480)).status_code in (200, 201)
    # The middle day is entirely inside the stay.
    clash = _plan(
        client, trip,
        at(6, 720), at(6, 780),
        item={"pin_id": trip.pins["ice"].id},
    )
    assert clash.status_code == 409, clash.text


def test_a_minute_past_24_00_is_the_next_morning(client, trip):
    """34:00 on day 5 is 10:00 on day 6: there's no separate date to roll
    over, so the client can't spell a time that doesn't exist."""
    res = _plan(client, trip, at(5, 1320), at(5, 2040))
    assert res.status_code in (200, 201), res.text
    assert res.json()["end_min"] == at(6, 600)
