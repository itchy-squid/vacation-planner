"""The one suggested set of TravelItem kinds.

flight/train/drive collapsed into "travel" — see app/schemas.py
TravelItemKind for why, and
alembic/versions/c4f1b8d20a37_collapse_travel_item_kinds.py for what
happens to rows that already carried one.
"""

import pytest


def test_travel_is_accepted(client, trip):
    res = client.post(
        f"/api/trips/{trip.id}/travel-items",
        json={"title": "Train then ferry to Xiaoliuqiu", "kind": "travel", "duration_minutes": 180},
    )
    assert res.status_code in (200, 201), res.text
    assert res.json()["kind"] == "travel"


def test_lodging_and_other_still_stand_apart(client, trip):
    for kind in ("lodging", "other"):
        res = client.post(
            f"/api/trips/{trip.id}/travel-items",
            json={"title": f"A {kind} item", "kind": kind},
        )
        assert res.status_code in (200, 201), res.text
        assert res.json()["kind"] == kind


@pytest.mark.parametrize("kind", ["flight", "train", "drive", "ferry"])
def test_the_old_split_is_gone(client, trip, kind):
    """Including "ferry", which the day form used to offer and this
    Literal never accepted — the 422 below is the bug the collapse fixes,
    not a regression it introduces."""
    res = client.post(
        f"/api/trips/{trip.id}/travel-items",
        json={"title": "Leg", "kind": kind},
    )
    assert res.status_code == 422, res.text


def test_kind_defaults_to_other(client, trip):
    res = client.post(f"/api/trips/{trip.id}/travel-items", json={"title": "Unclassified"})
    assert res.status_code in (200, 201), res.text
    assert res.json()["kind"] == "other"


def test_an_existing_item_can_be_patched_to_travel(client, trip):
    item_id = trip.travel_items["ferry"].id
    res = client.patch(f"/api/travel-items/{item_id}", json={"kind": "travel"})
    assert res.status_code == 200, res.text
    assert res.json()["kind"] == "travel"
    assert client.patch(f"/api/travel-items/{item_id}", json={"kind": "flight"}).status_code == 422
