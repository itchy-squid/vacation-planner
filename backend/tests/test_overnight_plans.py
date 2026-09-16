"""Plans that cross midnight.

The server has always been able to hold one — starts_at/ends_at are real
datetimes and every overlap check is a datetime comparison — but nothing
asserted it, and the client could not spell one: isoForDayMinute built the
timestamp by dividing minutes by 60 with no day rollover, so a 12h item
tapped at 22:00 asked for "...T34:00:00+00:00" and came back 422. These
tests pin the server half of that contract; frontend/src/lib/planTime.js
and lib/dayGrid.js carry the client half.
"""


def _plan(client, trip, starts_at, ends_at, *, item=None, status="placed"):
    return client.post(
        f"/api/trips/{trip.id}/plans",
        json={
            "starts_at": starts_at,
            "ends_at": ends_at,
            "status": status,
            "items": [item or {"travel_item_id": trip.travel_items["ferry"].id}],
        },
    )


def test_an_overnight_plan_is_accepted(client, trip):
    res = _plan(client, trip, "2026-10-07T22:00:00+00:00", "2026-10-08T10:00:00+00:00")
    assert res.status_code in (200, 201), res.text
    body = res.json()
    assert body["starts_at"].startswith("2026-10-07T22:00")
    assert body["ends_at"].startswith("2026-10-08T10:00")


def test_slack_is_measured_across_the_date_boundary(client, trip):
    """A 12h window holding a 75m ferry has 645m of slack — not the 10h a
    within-one-day `% 1440` reading of the same span would produce."""
    res = _plan(client, trip, "2026-10-07T22:00:00+00:00", "2026-10-08T10:00:00+00:00")
    body = res.json()
    assert body["total_duration_minutes"] == 75
    assert body["slack_minutes"] == 12 * 60 - 75


def test_the_next_morning_is_occupied(client, trip):
    """The hours after midnight belong to the plan that started the night
    before. This is what the day grid was blind to: it filtered plans by
    their *start* day, so it offered these hours as free and then took a
    409 from a plan the user could not see."""
    assert _plan(client, trip, "2026-10-07T22:00:00+00:00", "2026-10-08T10:00:00+00:00").status_code in (200, 201)

    clash = _plan(
        client, trip,
        "2026-10-08T08:00:00+00:00", "2026-10-08T09:00:00+00:00",
        item={"pin_id": trip.pins["ice"].id},
    )
    assert clash.status_code == 409, clash.text
    assert "occupying_plan_id" in clash.json()["detail"]


def test_touching_the_boundary_is_not_a_clash(client, trip):
    """Same rule as everywhere else: a shared minute conflicts, a shared
    edge does not — midnight is not special."""
    assert _plan(client, trip, "2026-10-07T22:00:00+00:00", "2026-10-08T00:00:00+00:00").status_code in (200, 201)
    res = _plan(
        client, trip,
        "2026-10-08T00:00:00+00:00", "2026-10-08T01:00:00+00:00",
        item={"pin_id": trip.pins["ice"].id},
    )
    assert res.status_code in (200, 201), res.text


def test_a_plan_can_be_moved_across_midnight(client, trip):
    created = _plan(client, trip, "2026-10-07T14:00:00+00:00", "2026-10-07T16:00:00+00:00").json()
    res = client.patch(
        f"/api/plans/{created['id']}",
        json={"starts_at": "2026-10-07T23:00:00+00:00", "ends_at": "2026-10-08T03:00:00+00:00"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["ends_at"].startswith("2026-10-08T03:00")


def test_a_multi_night_span_is_held_whole(client, trip):
    """36 hours. The client's old duration maths wrapped this to 12h; the
    server never did, so a stay is storable and these are the hours it
    actually occupies."""
    assert _plan(client, trip, "2026-10-07T20:00:00+00:00", "2026-10-09T08:00:00+00:00").status_code in (200, 201)
    # The middle day is entirely inside the stay.
    clash = _plan(
        client, trip,
        "2026-10-08T12:00:00+00:00", "2026-10-08T13:00:00+00:00",
        item={"pin_id": trip.pins["ice"].id},
    )
    assert clash.status_code == 409, clash.text


def test_an_hour_field_past_24_is_not_a_datetime(client, trip):
    """The exact string the client used to send. Kept as a regression
    marker: if isoForDayMinute ever loses its day carry again, this is the
    shape of the failure."""
    assert _plan(client, trip, "2026-10-07T22:00:00+00:00", "2026-10-07T34:00:00+00:00").status_code == 422
