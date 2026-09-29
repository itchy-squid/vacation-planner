"""Links on pins and travel items are opened by everyone on the trip, so
only web links are stored (app/schemas.py WebLink). A "javascript:" link
would run as whoever clicked it."""

import pytest

from conftest import as_user

UNSAFE = [
    "javascript:alert(document.cookie)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "java\tscript:alert(1)",
    "javascript://%0aalert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
]
SAFE = ["https://example.com/a?b=c", "http://example.com", "maps.app.goo.gl/abc", ""]


def new_pin(**fields):
    return {"title": "Spot", "place": "Spot", "region": "Here", **fields}


@pytest.mark.parametrize("link", UNSAFE)
def test_an_unsafe_pin_link_is_refused(client, trip, link):
    res = client.post(f"/api/trips/{trip.id}/pins", json=new_pin(link=link), headers=as_user("jae@example.com"))
    assert res.status_code == 422, res.text


@pytest.mark.parametrize("link", SAFE)
def test_web_links_and_bare_hosts_are_kept_as_typed(client, trip, link):
    res = client.post(f"/api/trips/{trip.id}/pins", json=new_pin(link=link), headers=as_user("jae@example.com"))
    assert res.status_code == 201, res.text
    assert res.json()["link"] == link


@pytest.mark.parametrize("field", ["link", "photo_url", "photo_source_url"])
def test_editing_a_pin_to_an_unsafe_link_is_refused(client, trip, field):
    pin = trip.pins["vase"]
    res = client.patch(f"/api/pins/{pin.id}", json={field: "javascript:alert(1)"}, headers=as_user("mei@example.com"))
    assert res.status_code == 422, res.text


def test_clearing_a_photo_is_still_allowed(client, trip):
    pin = trip.pins["vase"]
    res = client.patch(f"/api/pins/{pin.id}", json={"photo_url": None}, headers=as_user("mei@example.com"))
    assert res.status_code == 200, res.text


def test_an_unsafe_travel_item_link_is_refused(client, trip):
    created = client.post(
        f"/api/trips/{trip.id}/travel-items",
        json={"title": "Train", "link": "javascript:alert(1)"},
        headers=as_user("mei@example.com"),
    )
    assert created.status_code == 422, created.text

    item = trip.travel_items["ferry"]
    edited = client.patch(
        f"/api/travel-items/{item.id}", json={"link": "data:text/html,x"}, headers=as_user("mei@example.com")
    )
    assert edited.status_code == 422, edited.text
