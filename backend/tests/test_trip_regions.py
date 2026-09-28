"""Where a trip's regions are (routers/regions.py, app/models.py TripRegion).

A pin with no exact spot shows in its region on the Map tab. The frontend
looks a region up once and stores it here; everyone on the trip reads it
back. Names match whatever their case.
"""

import pytest

from app.models import Contributor

from conftest import as_user

MEI = as_user("mei@example.com")  # owner
JAE = as_user("jae@example.com")  # planner
RAE = as_user("rae@example.com")  # reader, added below
SAM = as_user("sam@example.com")  # not on the trip

COZUMEL = {"name": "Cozumel", "lat": 20.42, "lng": -86.92, "south": 20.26, "west": -87.03, "north": 20.6, "east": -86.72}


@pytest.fixture
def reader(trip, db):
    rae = Contributor(trip_id=trip.id, email="rae@example.com", display_name="Rae", initial="R", role="reader")
    db.add(rae)
    db.commit()
    return rae


def put(client, trip, body, headers=JAE):
    return client.put(f"/api/trips/{trip.id}/regions", json=body, headers=headers)


def regions(client, trip, headers=MEI):
    return client.get(f"/api/trips/{trip.id}/regions", headers=headers)


def test_a_trip_starts_with_no_region_locations(client, trip):
    assert regions(client, trip).json() == []


def test_setting_a_region_stores_where_it_is(client, trip):
    res = put(client, trip, COZUMEL)
    assert res.status_code == 200
    body = res.json()
    assert {k: body[k] for k in COZUMEL} == COZUMEL
    assert [r["name"] for r in regions(client, trip).json()] == ["Cozumel"]


def test_the_same_name_in_another_case_moves_it_rather_than_adding_one(client, trip):
    first = put(client, trip, COZUMEL).json()
    moved = put(client, trip, {**COZUMEL, "name": " cozumel ", "lat": 20.5}).json()
    assert moved["id"] == first["id"]
    assert moved["lat"] == 20.5
    assert moved["name"] == "cozumel"
    assert len(regions(client, trip).json()) == 1


@pytest.mark.parametrize(
    "change",
    [{"lat": 91}, {"lng": -181}, {"south": 20.7}, {"name": ""}, {"name": None}],
    ids=["lat-out-of-range", "lng-out-of-range", "south-north-of-north", "empty-name", "no-name"],
)
def test_a_bad_region_is_refused(client, trip, change):
    assert put(client, trip, {**COZUMEL, **change}).status_code == 422
    assert regions(client, trip).json() == []


def test_an_area_across_the_antimeridian_is_fine(client, trip):
    fiji = {"name": "Fiji", "lat": -17.7, "lng": 178.0, "south": -21.0, "west": 176.0, "north": -12.0, "east": -178.0}
    assert put(client, trip, fiji).status_code == 200


def test_readers_see_regions_but_cant_set_them(client, trip, reader):
    put(client, trip, COZUMEL)
    assert regions(client, trip, headers=as_user("rae@example.com")).status_code == 200
    assert put(client, trip, {**COZUMEL, "lat": 20.5}, headers=RAE).status_code == 403
    assert regions(client, trip).json()[0]["lat"] == COZUMEL["lat"]


def test_someone_off_the_trip_can_do_neither(client, trip):
    assert regions(client, trip, headers=SAM).status_code in (403, 404)
    assert put(client, trip, COZUMEL, headers=SAM).status_code in (403, 404)
