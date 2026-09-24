"""Per-trip roles, scopes, and invite links.

See app/permissions.py for the role -> scope mapping and
app/routers/sharing.py for membership and invites.
"""

import pytest
from fastapi.routing import APIRoute

from app.main import app
from app.models import Comment, Contributor, Plan, PlanStatus, TripInvite, Vote
from app.permissions import ROLE_SCOPES, Role

from conftest import as_user, at

MEI = as_user("mei@example.com")  # owner
JAE = as_user("jae@example.com")  # planner
RAE = as_user("rae@example.com")  # reader, added by the fixture below
KAI = as_user("kai@example.com")  # companion, added by the fixture below
SAM = as_user("sam@example.com")  # not on the trip


@pytest.fixture
def reader(trip, db):
    rae = Contributor(trip_id=trip.id, email="rae@example.com", display_name="Rae", initial="R", role="reader")
    db.add(rae)
    db.commit()
    return rae


@pytest.fixture
def companion(trip, db):
    kai = Contributor(trip_id=trip.id, email="kai@example.com", display_name="Kai", initial="K", role="companion")
    db.add(kai)
    db.commit()
    return kai


# --- the mapping itself -------------------------------------------------------


def test_reader_scopes_are_read_only_and_exclude_costs():
    reader = ROLE_SCOPES[Role.reader]
    assert "ideas:read" in reader
    assert "plans:read" in reader
    assert "costs:read" not in reader
    assert not any(scope.endswith(":write") for scope in reader)


def test_roles_nest():
    assert (
        ROLE_SCOPES[Role.reader]
        < ROLE_SCOPES[Role.companion]
        < ROLE_SCOPES[Role.planner]
        < ROLE_SCOPES[Role.owner]
    )
    assert "costs:read" in ROLE_SCOPES[Role.planner]
    assert "members:manage" not in ROLE_SCOPES[Role.planner]


# Routes that don't belong to one trip, and so can't name a trip scope.
_UNSCOPED = {
    ("GET", "/api/health"),
    ("GET", "/api/me"),
    # Your own account, not a trip (routers/account.py).
    ("GET", "/api/me/deletion-preview"),
    ("DELETE", "/api/me"),
    ("GET", "/api/trips"),
    ("POST", "/api/trips"),
    ("GET", "/api/invites/{token}"),
    ("POST", "/api/invites/{token}/accept"),
}


def _declared_scopes(route: APIRoute):
    if hasattr(route.endpoint, "required_scopes"):
        return route.endpoint.required_scopes
    for dep in route.dependant.dependencies:
        if hasattr(dep.call, "required_scopes"):
            return dep.call.required_scopes
    return None


def test_every_trip_route_declares_its_scopes():
    """A new endpoint that forgets require() fails here rather than
    quietly serving every signed-in user."""
    missing = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api/"):
            continue
        for method in route.methods:
            if (method, route.path) in _UNSCOPED:
                continue
            if _declared_scopes(route) is None:
                missing.append(f"{method} {route.path}")
    assert missing == []


# --- membership -----------------------------------------------------------------


def test_trips_list_only_shows_your_own(client, trip):
    assert [t["id"] for t in client.get("/api/trips", headers=MEI).json()] == [trip.id]
    assert client.get("/api/trips", headers=SAM).json() == []


def test_outsiders_are_turned_away(client, trip):
    for path in (
        f"/api/trips/{trip.id}",
        f"/api/trips/{trip.id}/pins",
        f"/api/trips/{trip.id}/plans",
        f"/api/pins/{trip.pins['vase'].id}",
    ):
        res = client.get(path, headers=SAM)
        assert res.status_code == 403, path
    # No auto-enrolment as a side effect.
    assert client.get("/api/trips", headers=SAM).json() == []


def test_trip_carries_the_callers_role_and_the_owner(client, trip, reader):
    body = client.get(f"/api/trips/{trip.id}", headers=RAE).json()
    assert body["my_role"] == "reader"
    assert body["my_contributor_id"] == reader.id
    assert "costs:read" not in body["my_scopes"]
    assert body["owner"]["display_name"] == "Mei"
    assert body["member_count"] == 5

    body = client.get(f"/api/trips/{trip.id}", headers=MEI).json()
    assert body["my_role"] == "owner"
    assert "members:manage" in body["my_scopes"]


def test_a_missing_trip_is_404_not_403(client, trip):
    assert client.get("/api/trips/9999", headers=MEI).status_code == 404
    assert client.get("/api/pins/9999", headers=MEI).status_code == 404


def test_create_trip_makes_the_creator_owner(client):
    res = client.post("/api/trips", json={"name": "Lisbon"}, headers=SAM)
    assert res.status_code == 201
    assert res.json()["my_role"] == "owner"
    assert res.json()["owner"]["email"] == "sam@example.com"


# --- readers ----------------------------------------------------------------------


def test_reader_sees_ideas_and_plans_without_costs(client, trip, reader):
    trip.place(start=840, end=900, pin="tide")
    trip.place(start=600, end=675, travel_item="ferry")

    pins = client.get(f"/api/trips/{trip.id}/pins", headers=RAE).json()
    assert pins and all(p["cost_cents"] is None and p["heads"] is None for p in pins)

    items = client.get(f"/api/trips/{trip.id}/travel-items", headers=RAE).json()
    assert items and all(t["cost_cents"] is None for t in items)

    plans = client.get(f"/api/trips/{trip.id}/plans", headers=RAE).json()
    assert len(plans) == 2
    for plan in plans:
        assert plan["total_cost_cents"] is None
        for item in plan["items"]:
            target = item["pin"] or item["travel_item"]
            assert target["cost_cents"] is None

    one = client.get(f"/api/pins/{trip.pins['tide'].id}", headers=RAE).json()
    assert one["cost_cents"] is None


def test_planner_still_sees_costs(client, trip, reader):
    trip.place(start=840, end=900, pin="tide")
    assert client.get(f"/api/pins/{trip.pins['tide'].id}", headers=JAE).json()["cost_cents"] == 500
    plan = client.get(f"/api/trips/{trip.id}/plans", headers=JAE).json()[0]
    assert plan["total_cost_cents"] == 500


def test_cost_visibility_does_not_leak_between_requests(client, trip, reader):
    """A reader's request right after a planner's (and the reverse)
    gets its own answer."""
    pin_path = f"/api/pins/{trip.pins['tide'].id}"
    assert client.get(pin_path, headers=JAE).json()["cost_cents"] == 500
    assert client.get(pin_path, headers=RAE).json()["cost_cents"] is None
    assert client.get(pin_path, headers=JAE).json()["cost_cents"] == 500


def test_reader_sees_contests_but_cannot_vote(client, trip, reader):
    trip.place(start=840, end=900, pin="tide")
    res = client.post(
        f"/api/trips/{trip.id}/contests",
        json={
            "starts_at": at(1, 780).isoformat(),
            "ends_at": at(1, 1080).isoformat(),
            "items": [{"pin_id": trip.pins["vase"].id}],
        },
        headers=JAE,
    )
    assert res.status_code == 201, res.text
    contest_id = res.json()["id"]
    proposal_id = res.json()["plans"][1]["id"]

    body = client.get(f"/api/contests/{contest_id}", headers=RAE).json()
    assert all(p["total_cost_cents"] is None for p in body["plans"])
    # Four people can vote; the reader isn't one of them.
    assert body["contributor_count"] == 4

    res = client.post(f"/api/contests/{contest_id}/vote", json={"plan_id": proposal_id}, headers=RAE)
    assert res.status_code == 403
    assert res.json()["detail"]["missing_scope"] == "votes:write"


@pytest.mark.parametrize(
    "method,path_fn,body_fn",
    [
        ("post", lambda t: f"/api/trips/{t.id}/pins", lambda t: {"title": "X", "short": "X", "place": "X", "region": "X"}),
        ("patch", lambda t: f"/api/pins/{t.pins['vase'].id}", lambda t: {"title": "Renamed"}),
        ("delete", lambda t: f"/api/pins/{t.pins['vase'].id}", lambda t: None),
        ("put", lambda t: f"/api/pins/{t.pins['vase'].id}/availability-rule", lambda t: {"days": [3]}),
        ("post", lambda t: f"/api/pins/{t.pins['vase'].id}/availability-overrides/toggle", lambda t: {"day": 3, "band": "AM"}),
        ("post", lambda t: f"/api/trips/{t.id}/travel-items", lambda t: {"title": "Taxi"}),
        ("patch", lambda t: f"/api/travel-items/{t.travel_items['ferry'].id}", lambda t: {"title": "Boat"}),
        ("delete", lambda t: f"/api/travel-items/{t.travel_items['ferry'].id}", lambda t: None),
        (
            "post",
            lambda t: f"/api/trips/{t.id}/plans",
            lambda t: {"starts_at": at(2, 600).isoformat(), "ends_at": at(2, 660).isoformat(), "items": [{"pin_id": t.pins["vase"].id}]},
        ),
        (
            "post",
            lambda t: f"/api/trips/{t.id}/contests",
            lambda t: {"starts_at": at(2, 600).isoformat(), "ends_at": at(2, 700).isoformat(), "items": [{"pin_id": t.pins["vase"].id}]},
        ),
        ("post", lambda t: f"/api/trips/{t.id}/comments", lambda t: {"body": "hi"}),
        ("patch", lambda t: f"/api/trips/{t.id}", lambda t: {"name": "Renamed"}),
        ("get", lambda t: f"/api/trips/{t.id}/invites", lambda t: None),
    ],
)
def test_reader_cannot_write(client, trip, reader, method, path_fn, body_fn):
    body = body_fn(trip)
    kwargs = {"headers": RAE}
    if body is not None:
        kwargs["json"] = body
    res = getattr(client, method)(path_fn(trip), **kwargs)
    assert res.status_code == 403, res.text


def test_reader_cannot_move_or_remove_a_plan(client, trip, reader):
    plan = trip.place(start=840, end=900, pin="tide")
    assert client.patch(f"/api/plans/{plan.id}", json={"starts_at": at(1, 900).isoformat()}, headers=RAE).status_code == 403
    assert client.delete(f"/api/plans/{plan.id}", headers=RAE).status_code == 403
    assert client.post(f"/api/plans/{plan.id}/lock", headers=RAE).status_code == 403


# --- companions ----------------------------------------------------------------------

_NEW_PIN = {"title": "Night market", "short": "Market", "place": "Donggang", "region": "Xiaoliuqiu"}


def _propose(client, trip, headers, items=None):
    return client.post(
        f"/api/trips/{trip.id}/contests",
        json={
            "starts_at": at(1, 780).isoformat(),
            "ends_at": at(1, 1080).isoformat(),
            "items": items or [{"pin_id": trip.pins["vase"].id}],
        },
        headers=headers,
    )


def test_companion_scopes():
    companion = ROLE_SCOPES[Role.companion]
    assert {"ideas:add", "plans:propose", "votes:write", "comments:write", "costs:own"} <= companion
    assert not {"ideas:write", "plans:write", "costs:read", "costs:write", "plans:decide"} & companion


def test_companion_adds_an_idea_with_a_cost_and_sees_only_that_cost(client, trip, companion):
    res = client.post(f"/api/trips/{trip.id}/pins", json={**_NEW_PIN, "cost_cents": 1200}, headers=KAI)
    assert res.status_code == 201, res.text
    mine = res.json()
    assert mine["added_by_id"] == companion.id
    assert mine["cost_cents"] == 1200

    res = client.patch(f"/api/pins/{mine['id']}", json={"cost_cents": 1500, "heads": [companion.id]}, headers=KAI)
    assert res.status_code == 200, res.text
    assert res.json()["cost_cents"] == 1500

    pins = {p["id"]: p for p in client.get(f"/api/trips/{trip.id}/pins", headers=KAI).json()}
    assert pins[mine["id"]]["cost_cents"] == 1500
    assert pins[mine["id"]]["heads"] == [companion.id]
    others = [p for pid, p in pins.items() if pid != mine["id"]]
    assert others and all(p["cost_cents"] is None and p["heads"] is None for p in others)
    # Everyone else still sees it.
    assert client.get(f"/api/pins/{mine['id']}", headers=JAE).json()["cost_cents"] == 1500


def test_companion_sees_no_plan_totals(client, trip, companion):
    trip.place(start=840, end=900, pin="tide")
    plans = client.get(f"/api/trips/{trip.id}/plans", headers=KAI).json()
    assert plans and all(p["total_cost_cents"] is None for p in plans)


def test_companion_adds_a_custom_event_with_a_cost(client, trip, companion):
    res = client.post(f"/api/trips/{trip.id}/travel-items", json={"title": "Scooter hire", "cost_cents": 800}, headers=KAI)
    assert res.status_code == 201, res.text
    item_id = res.json()["id"]
    assert res.json()["cost_cents"] == 800
    assert client.patch(f"/api/travel-items/{item_id}", json={"title": "Scooters"}, headers=KAI).status_code == 200
    assert client.delete(f"/api/travel-items/{item_id}", headers=KAI).status_code == 204


def test_companion_cannot_change_someone_elses_idea(client, trip, companion):
    vase = trip.pins["vase"].id
    ferry = trip.travel_items["ferry"].id
    for method, path, body in [
        ("patch", f"/api/pins/{vase}", {"title": "Renamed"}),
        ("delete", f"/api/pins/{vase}", None),
        ("put", f"/api/pins/{vase}/availability-rule", {"days": [3]}),
        ("post", f"/api/pins/{vase}/availability-overrides/toggle", {"day": 3, "band": "AM"}),
        ("patch", f"/api/travel-items/{ferry}", {"title": "Boat"}),
        ("patch", f"/api/travel-items/{ferry}", {"cost_cents": 100}),
        ("delete", f"/api/travel-items/{ferry}", None),
    ]:
        kwargs = {"headers": KAI}
        if body is not None:
            kwargs["json"] = body
        res = getattr(client, method)(path, **kwargs)
        assert res.status_code == 403, (method, path, res.text)


def test_companion_edits_and_deletes_their_own_idea(client, trip, companion):
    pin_id = client.post(f"/api/trips/{trip.id}/pins", json=_NEW_PIN, headers=KAI).json()["id"]
    assert client.put(f"/api/pins/{pin_id}/availability-rule", json={"days": [3]}, headers=KAI).status_code == 200
    assert client.patch(f"/api/pins/{pin_id}", json={"title": "Donggang market"}, headers=KAI).status_code == 200
    assert client.delete(f"/api/pins/{pin_id}", headers=KAI).status_code == 204


def test_planner_can_change_a_companions_idea(client, trip, companion):
    pin_id = client.post(f"/api/trips/{trip.id}/pins", json=_NEW_PIN, headers=KAI).json()["id"]
    assert client.patch(f"/api/pins/{pin_id}", json={"cost_cents": 900}, headers=JAE).status_code == 200


def test_companion_cannot_place_move_or_remove_on_the_calendar(client, trip, companion):
    res = client.post(
        f"/api/trips/{trip.id}/plans",
        json={"starts_at": at(2, 600).isoformat(), "ends_at": at(2, 660).isoformat(), "items": [{"pin_id": trip.pins["vase"].id}]},
        headers=KAI,
    )
    assert res.status_code == 403
    assert res.json()["detail"]["missing_scope"] == "plans:write"

    plan = trip.place(start=840, end=900, pin="tide")
    assert client.patch(f"/api/plans/{plan.id}", json={"starts_at": at(1, 900).isoformat()}, headers=KAI).status_code == 403
    assert client.delete(f"/api/plans/{plan.id}", headers=KAI).status_code == 403
    assert client.post(f"/api/plans/{plan.id}/lock", headers=KAI).status_code == 403


def test_companion_keeps_publishes_and_discards_drafts(client, trip, companion):
    body = {
        "starts_at": at(2, 600).isoformat(),
        "ends_at": at(2, 660).isoformat(),
        "status": "draft",
        "items": [{"pin_id": trip.pins["vase"].id}],
    }
    res = client.post(f"/api/trips/{trip.id}/plans", json=body, headers=KAI)
    assert res.status_code == 201, res.text
    assert client.delete(f"/api/plans/{res.json()['id']}", headers=KAI).status_code == 204

    draft_id = client.post(f"/api/trips/{trip.id}/plans", json=body, headers=KAI).json()["id"]
    res = client.post(f"/api/plans/{draft_id}/publish", headers=KAI)
    assert res.status_code == 201, res.text


def test_companion_proposes_edits_their_set_and_votes(client, trip, companion):
    trip.place(start=840, end=900, pin="tide")
    res = _propose(client, trip, KAI)
    assert res.status_code == 201, res.text
    contest = res.json()
    # Companions vote, so they count: four planners/owner plus Kai.
    assert contest["contributor_count"] == 5
    assert all(p["total_cost_cents"] is None for p in contest["plans"])
    mine = contest["plans"][1]["id"]

    res = client.put(
        f"/api/plans/{mine}/stops",
        json={"label": "Beach instead", "items": [{"pin_id": trip.pins["beach"].id}]},
        headers=KAI,
    )
    assert res.status_code == 200, res.text

    res = client.post(f"/api/contests/{contest['id']}/vote", json={"plan_id": mine}, headers=KAI)
    assert res.status_code == 200, res.text
    assert res.json()["my_vote_plan_id"] == mine

    # A set someone else proposed isn't theirs to edit.
    other = _propose(client, trip, JAE).json()
    theirs = next(p["id"] for p in other["plans"] if p["id"] not in {pl["id"] for pl in contest["plans"]})
    res = client.put(
        f"/api/plans/{theirs}/stops",
        json={"label": "Mine now", "items": [{"pin_id": trip.pins["cave"].id}]},
        headers=KAI,
    )
    assert res.status_code == 403


def test_companion_comments(client, trip, companion):
    res = client.post(f"/api/trips/{trip.id}/comments", json={"body": "yes please", "pin_id": trip.pins["vase"].id}, headers=KAI)
    assert res.status_code in (200, 201), res.text


def test_demoting_a_companion_to_reader_clears_their_votes_but_to_planner_does_not(client, trip, companion, db):
    trip.place(start=840, end=900, pin="tide")
    contest = _propose(client, trip, JAE).json()
    client.post(f"/api/contests/{contest['id']}/vote", json={"plan_id": contest["plans"][1]["id"]}, headers=KAI)

    assert client.patch(f"/api/trips/{trip.id}/contributors/{companion.id}", json={"role": "planner"}, headers=MEI).status_code == 200
    db.expire_all()
    assert db.query(Vote).filter_by(contributor_id=companion.id).count() == 1

    assert client.patch(f"/api/trips/{trip.id}/contributors/{companion.id}", json={"role": "reader"}, headers=MEI).status_code == 200
    db.expire_all()
    assert db.query(Vote).filter_by(contributor_id=companion.id).count() == 0


def test_join_as_companion(client, trip):
    link = make_link(client, trip, "companion")
    assert client.get(f"/api/invites/{link['token']}", headers=SAM).json()["role"] == "companion"
    res = client.post(f"/api/invites/{link['token']}/accept", headers=SAM)
    assert res.json()["my_role"] == "companion"
    assert "costs:read" not in res.json()["my_scopes"]
    assert client.get(f"/api/pins/{trip.pins['tide'].id}", headers=SAM).json()["cost_cents"] is None


# --- owner-only ----------------------------------------------------------------------


def test_trip_settings_are_owner_only(client, trip):
    assert client.patch(f"/api/trips/{trip.id}", json={"name": "X"}, headers=JAE).status_code == 403
    res = client.patch(f"/api/trips/{trip.id}", json={"name": "Taiwan, again"}, headers=MEI)
    assert res.status_code == 200
    assert res.json()["name"] == "Taiwan, again"


def test_planner_cannot_lock_or_manage_people(client, trip):
    plan = trip.place(start=840, end=900, pin="tide")
    res = client.post(f"/api/plans/{plan.id}/lock", headers=JAE)
    assert res.status_code == 403
    assert res.json()["detail"]["missing_scope"] == "plans:decide"
    assert client.post(f"/api/trips/{trip.id}/invites", json={"role": "reader"}, headers=JAE).status_code == 403
    assert client.patch(f"/api/trips/{trip.id}/contributors/{trip.ana.id}", json={"role": "reader"}, headers=JAE).status_code == 403
    assert client.delete(f"/api/trips/{trip.id}/contributors/{trip.ana.id}", headers=JAE).status_code == 403


def test_owner_changes_a_role_and_votes_are_cleared_on_demotion(client, trip, db):
    trip.place(start=840, end=900, pin="tide")
    res = client.post(
        f"/api/trips/{trip.id}/contests",
        json={"starts_at": at(1, 780).isoformat(), "ends_at": at(1, 1080).isoformat(), "items": [{"pin_id": trip.pins["vase"].id}]},
        headers=JAE,
    )
    contest_id = res.json()["id"]
    trip.vote(contest_id, res.json()["plans"][1]["id"], "ana")

    res = client.patch(f"/api/trips/{trip.id}/contributors/{trip.ana.id}", json={"role": "reader"}, headers=MEI)
    assert res.status_code == 200
    assert res.json()["role"] == "reader"
    db.expire_all()
    assert db.query(Vote).filter_by(contributor_id=trip.ana.id).count() == 0
    assert client.get(f"/api/pins/{trip.pins['tide'].id}", headers=as_user("ana@example.com")).json()["cost_cents"] is None


def test_owner_role_cannot_be_changed_or_granted(client, trip):
    assert client.patch(f"/api/trips/{trip.id}/contributors/{trip.mei.id}", json={"role": "reader"}, headers=MEI).status_code == 409
    assert client.patch(f"/api/trips/{trip.id}/contributors/{trip.ana.id}", json={"role": "owner"}, headers=MEI).status_code == 422


def test_a_member_of_another_trip_cannot_be_edited_through_this_one(client, trip):
    other = client.post("/api/trips", json={"name": "Elsewhere"}, headers=SAM).json()
    sam_id = client.get(f"/api/trips/{other['id']}/contributors", headers=SAM).json()[0]["id"]
    assert client.delete(f"/api/trips/{trip.id}/contributors/{sam_id}", headers=MEI).status_code == 404


def test_removing_someone_keeps_what_they_added(client, trip, db):
    trip.pins["vase"].added_by_id = trip.jae.id
    trip.pins["ice"].heads = [trip.travelers["jae"].id, trip.travelers["ana"].id]
    db.commit()
    placed = trip.place(start=840, end=900, pin="tide", created_by="jae")
    draft = trip.place(day=2, start=600, end=660, pin="cave", created_by="jae", status=PlanStatus.draft)
    db.add(Comment(pin_id=trip.pins["vase"].id, contributor_id=trip.jae.id, body="yes"))
    db.commit()
    draft_id = draft.id
    jae_id = trip.jae.id
    jae_traveler, ana_traveler = trip.travelers["jae"].id, trip.travelers["ana"].id

    assert client.delete(f"/api/trips/{trip.id}/contributors/{jae_id}", headers=MEI).status_code == 204

    db.expire_all()
    assert db.get(Contributor, jae_id) is None
    assert db.get(Plan, placed.id).created_by_id is None
    assert db.get(Plan, draft_id) is None
    assert trip.pins["vase"].added_by_id is None
    # Jae is off the app but still going: the traveler stays on the split.
    assert trip.pins["ice"].heads == [jae_traveler, ana_traveler]
    assert db.query(Comment).count() == 0
    assert client.get(f"/api/trips/{trip.id}", headers=JAE).status_code == 403


def test_leaving(client, trip):
    assert client.post(f"/api/trips/{trip.id}/leave", headers=MEI).status_code == 409
    assert client.post(f"/api/trips/{trip.id}/leave", headers=JAE).status_code == 204
    assert client.get("/api/trips", headers=JAE).json() == []


# --- invite links ----------------------------------------------------------------------


def make_link(client, trip, role):
    res = client.post(f"/api/trips/{trip.id}/invites", json={"role": role}, headers=MEI)
    assert res.status_code == 200, res.text
    return res.json()


def test_one_live_link_per_role(client, trip):
    first = make_link(client, trip, "reader")
    again = make_link(client, trip, "reader")
    contrib = make_link(client, trip, "planner")
    assert first["token"] == again["token"]
    assert contrib["token"] != first["token"]
    assert len(client.get(f"/api/trips/{trip.id}/invites", headers=MEI).json()) == 2


def test_invite_role_must_be_grantable(client, trip):
    res = client.post(f"/api/trips/{trip.id}/invites", json={"role": "owner"}, headers=MEI)
    assert res.status_code == 422


def test_join_as_reader(client, trip):
    link = make_link(client, trip, "reader")

    preview = client.get(f"/api/invites/{link['token']}", headers=SAM).json()
    assert preview["trip_name"] == "Taiwan"
    assert preview["role"] == "reader"
    assert preview["owner"]["display_name"] == "Mei"
    assert preview["already_member"] is False
    # The preview carries nothing a member endpoint guards.
    assert client.get(f"/api/trips/{trip.id}/pins", headers=SAM).status_code == 403

    res = client.post(f"/api/invites/{link['token']}/accept", headers=SAM)
    assert res.status_code == 200, res.text
    assert res.json()["my_role"] == "reader"
    assert [t["id"] for t in client.get("/api/trips", headers=SAM).json()] == [trip.id]
    assert client.get(f"/api/pins/{trip.pins['tide'].id}", headers=SAM).json()["cost_cents"] is None

    counts = {i["role"]: i["joined_count"] for i in client.get(f"/api/trips/{trip.id}/invites", headers=MEI).json()}
    assert counts == {"reader": 1}


def test_join_as_planner(client, trip):
    link = make_link(client, trip, "planner")
    res = client.post(f"/api/invites/{link['token']}/accept", headers=SAM)
    assert res.json()["my_role"] == "planner"
    assert client.get(f"/api/pins/{trip.pins['tide'].id}", headers=SAM).json()["cost_cents"] == 500
    res = client.patch(f"/api/pins/{trip.pins['tide'].id}", json={"title": "Tide pools"}, headers=SAM)
    assert res.status_code == 200


def test_accepting_twice_or_as_a_member_keeps_the_existing_role(client, trip, reader):
    contrib = make_link(client, trip, "planner")
    reader_link = make_link(client, trip, "reader")

    # A reader holding a planner link stays a reader.
    assert client.get(f"/api/invites/{contrib['token']}", headers=RAE).json()["already_member"] is True
    assert client.post(f"/api/invites/{contrib['token']}/accept", headers=RAE).json()["my_role"] == "reader"
    # And a planner holding a reader link stays a planner.
    assert client.post(f"/api/invites/{reader_link['token']}/accept", headers=JAE).json()["my_role"] == "planner"

    client.post(f"/api/invites/{contrib['token']}/accept", headers=SAM)
    client.post(f"/api/invites/{contrib['token']}/accept", headers=SAM)
    emails = [c["email"] for c in client.get(f"/api/trips/{trip.id}/contributors", headers=MEI).json()]
    assert emails.count("sam@example.com") == 1


def test_a_revoked_link_stops_working_but_keeps_its_members(client, trip, db):
    link = make_link(client, trip, "reader")
    client.post(f"/api/invites/{link['token']}/accept", headers=SAM)

    assert client.delete(f"/api/trips/{trip.id}/invites/{link['id']}", headers=MEI).status_code == 204
    assert client.get(f"/api/invites/{link['token']}", headers=as_user("zed@example.com")).status_code == 404
    assert client.post(f"/api/invites/{link['token']}/accept", headers=as_user("zed@example.com")).status_code == 404
    assert client.get(f"/api/trips/{trip.id}", headers=SAM).status_code == 200
    assert client.get(f"/api/trips/{trip.id}/invites", headers=MEI).json() == []

    # A fresh link for the same role is a new token.
    assert make_link(client, trip, "reader")["token"] != link["token"]
    assert db.query(TripInvite).count() == 2


def test_an_unknown_link_is_404(client, trip):
    assert client.get("/api/invites/nope", headers=SAM).status_code == 404


def test_revoking_another_trips_link_is_404(client, trip):
    other = client.post("/api/trips", json={"name": "Elsewhere"}, headers=MEI).json()
    link = client.post(f"/api/trips/{other['id']}/invites", json={"role": "reader"}, headers=MEI).json()
    assert client.delete(f"/api/trips/{trip.id}/invites/{link['id']}", headers=MEI).status_code == 404


def test_event_stream_is_members_only(client, trip):
    assert client.get(f"/api/trips/{trip.id}/events", headers=SAM).status_code == 403
    assert client.get("/api/trips/9999/events", headers=SAM).status_code == 404
