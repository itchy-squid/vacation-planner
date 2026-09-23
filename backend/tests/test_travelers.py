"""Travelers: the people going, who pays for whom, per-person prices, and
where people added later land when the group has split.

See app/models.py Traveler, app/party.py and routers/travelers.py.
"""

from app.models import Contributor, Traveler, TripInvite

from conftest import as_user, at

MEI = as_user("mei@example.com")
JAE = as_user("jae@example.com")


def tid(trip, key):
    return trip.travelers[key].id


def add(client, trip, name, **fields):
    res = client.post(f"/api/trips/{trip.id}/travelers", json={"name": name, **fields}, headers=MEI)
    assert res.status_code == 201, res.text
    return res.json()


def set_price(trip, pin, cents, basis):
    trip.pins[pin].cost_cents = cents
    trip.pins[pin].cost_basis = basis
    trip.db.commit()


def plan_json(client, trip, plan_id):
    return next(p for p in client.get(f"/api/trips/{trip.id}/plans", headers=MEI).json() if p["id"] == plan_id)


# ---- the roster ----


def test_listing_someone_without_an_account(client, trip):
    kai = add(client, trip, "Kai", paid_by_id=tid(trip, "mei"))
    assert kai["contributor_id"] is None
    assert kai["paid_by_id"] == tid(trip, "mei")
    assert kai["initial"] == "K"
    roster = client.get(f"/api/trips/{trip.id}/travelers", headers=JAE).json()
    assert [t["name"] for t in roster] == ["Mei", "Jae", "Ana", "Lin", "Kai"]


def test_only_planners_manage_the_roster_but_anyone_edits_themselves(client, trip, db):
    trip.jae.role = "companion"
    db.commit()
    assert client.post(f"/api/trips/{trip.id}/travelers", json={"name": "X"}, headers=JAE).status_code == 403
    me = tid(trip, "jae")
    ok = client.patch(f"/api/travelers/{me}", json={"name": "Jae-won", "paid_by_id": tid(trip, "mei")}, headers=JAE)
    assert ok.status_code == 200, ok.text
    assert ok.json()["name"] == "Jae-won"
    other = client.patch(f"/api/travelers/{tid(trip, 'ana')}", json={"name": "Nope"}, headers=JAE)
    assert other.status_code == 403


def test_paying_for_others_is_one_level(client, trip):
    mei, jae = tid(trip, "mei"), tid(trip, "jae")
    assert client.patch(f"/api/travelers/{jae}", json={"paid_by_id": mei}, headers=MEI).status_code == 200
    # Jae is paid for, so can't pay for anyone...
    kai = add(client, trip, "Kai")
    assert client.patch(f"/api/travelers/{kai['id']}", json={"paid_by_id": jae}, headers=MEI).status_code == 400
    # ...and Mei pays for Jae, so can't be paid for.
    assert client.patch(f"/api/travelers/{mei}", json={"paid_by_id": tid(trip, "ana")}, headers=MEI).status_code == 400
    # Paying for yourself is just null.
    assert client.patch(f"/api/travelers/{jae}", json={"paid_by_id": jae}, headers=MEI).json()["paid_by_id"] is None


def test_editing_a_traveler_can_unlink_and_relink_an_account(client, trip, db):
    """The edit screen is the add screen: a planner can say someone isn't
    on the app after all, or link them to a member, as well as rename them."""
    kai = add(client, trip, "Kai")
    lin = tid(trip, "lin")
    res = client.patch(f"/api/travelers/{lin}", json={"contributor_id": None, "name": "Lin W"}, headers=MEI)
    assert res.status_code == 200, res.text
    assert res.json()["contributor_id"] is None and res.json()["name"] == "Lin W"
    # Lin's account is free again, so it can be linked to another row.
    res = client.patch(f"/api/travelers/{kai['id']}", json={"contributor_id": trip.lin.id}, headers=MEI)
    assert res.status_code == 200, res.text
    assert res.json()["contributor_id"] == trip.lin.id


def test_linking_a_member_who_is_already_listed_is_refused(client, trip):
    res = client.post(f"/api/trips/{trip.id}/travelers", json={"name": "Jae again", "contributor_id": trip.jae.id}, headers=MEI)
    assert res.status_code == 409


def test_removing_a_traveler_clears_them_everywhere(client, trip, db):
    kai = add(client, trip, "Kai", paid_by_id=tid(trip, "mei"))
    hua = add(client, trip, "Hua")
    client.patch(f"/api/travelers/{kai['id']}", json={"paid_by_id": hua["id"]}, headers=MEI)
    trip.pins["ice"].heads = [kai["id"], tid(trip, "ana")]
    db.commit()
    assert client.delete(f"/api/travelers/{hua['id']}", headers=MEI).status_code == 204
    db.expire_all()
    assert db.get(Traveler, kai["id"]).paid_by_id is None
    assert client.delete(f"/api/travelers/{kai['id']}", headers=MEI).status_code == 204
    db.expire_all()
    assert trip.pins["ice"].heads == [tid(trip, "ana")]


# ---- money ----


def test_a_per_person_price_multiplies_and_a_group_price_divides(client, trip):
    set_price(trip, "tide", 1200, "per_head")
    set_price(trip, "ice", 1000, "group")
    per = trip.place(start=540, end=620, pin="tide")
    group = trip.place(start=700, end=730, pin="ice")

    item = plan_json(client, trip, per.id)["items"][0]
    assert item["each_cents"] == 1200 and item["total_cents"] == 4800
    assert len(item["sharer_ids"]) == 4

    item = plan_json(client, trip, group.id)["items"][0]
    assert item["each_cents"] == 250 and item["total_cents"] == 1000
    assert plan_json(client, trip, group.id)["total_cost_cents"] == 1000


def test_costs_follow_the_group_on_a_split_day(client, trip, db):
    set_price(trip, "trail", 8000, "per_head")
    plan = trip.place(start=540, end=720, pin="trail")
    plan.party, plan.party_mode = sorted([tid(trip, "ana"), tid(trip, "lin")]), "only"
    db.commit()
    item = plan_json(client, trip, plan.id)["items"][0]
    assert item["sharer_ids"] == sorted([tid(trip, "ana"), tid(trip, "lin")])
    assert item["total_cents"] == 16000


def test_heads_still_win_over_the_group(client, trip, db):
    set_price(trip, "tide", 500, "per_head")
    trip.pins["tide"].heads = [tid(trip, "jae")]
    db.commit()
    plan = trip.place(start=540, end=620, pin="tide")
    item = plan_json(client, trip, plan.id)["items"][0]
    assert item["sharer_ids"] == [tid(trip, "jae")]
    assert item["total_cents"] == 500


def test_a_new_pin_defaults_to_per_person(client, trip):
    res = client.post(
        f"/api/trips/{trip.id}/pins",
        json={"title": "Kayak", "short": "Kayak", "place": "Bay", "region": "Xiaoliuqiu", "cost_cents": 900},
        headers=MEI,
    )
    assert res.status_code == 201, res.text
    assert res.json()["cost_basis"] == "per_head"
    res = client.patch(f"/api/pins/{res.json()['id']}", json={"cost_basis": "group"}, headers=MEI)
    assert res.json()["cost_basis"] == "group"


# ---- newcomers after a split ----


def split(client, trip, plan, leaving, **extra):
    res = client.post(f"/api/plans/{plan.id}/split", json={"leaving": leaving, **extra}, headers=MEI)
    assert res.status_code == 201, res.text
    return res.json()


def test_someone_added_after_a_split_joins_the_new_group_by_default(client, trip):
    plan = trip.place(start=540, end=720, pin="trail")
    stayed, branch = split(client, trip, plan, [tid(trip, "ana"), tid(trip, "lin")])
    kai = add(client, trip, "Kai")
    stayed, branch = plan_json(client, trip, stayed["id"]), plan_json(client, trip, branch["id"])
    assert kai["id"] in branch["party_members"]
    assert kai["id"] not in stayed["party_members"]


def test_newcomers_can_join_the_plan_being_split_or_neither(client, trip):
    first = trip.place(start=540, end=600, pin="trail")
    stayed, _ = split(client, trip, first, [tid(trip, "ana")], newcomers="stay")
    second = trip.place(start=700, end=760, pin="tide")
    stayed2, branch2 = split(client, trip, second, [tid(trip, "ana")], newcomers="none")
    kai = add(client, trip, "Kai")
    assert kai["id"] in plan_json(client, trip, stayed["id"])["party_members"]
    assert kai["id"] not in plan_json(client, trip, stayed2["id"])["party_members"]
    assert kai["id"] not in plan_json(client, trip, branch2["id"])["party_members"]


def test_two_groups_that_both_take_newcomers_would_collide(client, trip, db):
    """Two "except" plans at once would put the next person added on both,
    so the overlap rule treats them as clashing."""
    plan = trip.place(start=540, end=720, pin="trail")
    _, branch = split(client, trip, plan, [tid(trip, "ana")])
    res = client.put(f"/api/plans/{plan.id}/party", json={"party": [tid(trip, "ana")], "party_mode": "except"}, headers=MEI)
    assert res.status_code == 409


# ---- joining and voting are about the traveler you are ----


def test_joining_moves_your_traveler(client, trip, db):
    plan = trip.place(start=540, end=720, pin="trail")
    stayed, branch = split(client, trip, plan, [tid(trip, "ana"), tid(trip, "lin")])
    res = client.post(f"/api/plans/{branch['id']}/join", headers=JAE)
    assert res.status_code == 200, res.text
    assert tid(trip, "jae") in res.json()[0]["party_members"]
    assert tid(trip, "jae") not in plan_json(client, trip, stayed["id"])["party_members"]


def test_a_planner_who_isnt_going_cant_join_a_group(client, trip, db):
    plan = trip.place(start=540, end=720, pin="trail")
    _, branch = split(client, trip, plan, [tid(trip, "ana")])
    assert client.delete(f"/api/travelers/{tid(trip, 'jae')}", headers=MEI).status_code == 204
    assert client.post(f"/api/plans/{branch['id']}/join", headers=JAE).status_code == 409


def test_travelers_without_an_account_dont_count_as_voters(client, trip, db):
    kai = add(client, trip, "Kai")
    plan = trip.place(start=540, end=640, pin="tide")
    plan.party, plan.party_mode = sorted([tid(trip, "jae"), kai["id"]]), "only"
    db.commit()
    res = client.post(
        f"/api/trips/{trip.id}/contests",
        json={
            "starts_at": at(1, 540).isoformat(), "ends_at": at(1, 720).isoformat(),
            "items": [{"pin_id": trip.pins["vase"].id}],
            "party": sorted([tid(trip, "jae"), kai["id"]]),
        },
        headers=JAE,
    )
    assert res.status_code == 201, res.text
    assert res.json()["contributor_count"] == 1


# ---- invites that claim a traveler ----


def test_an_invite_made_for_a_traveler_signs_in_as_them(client, trip, db):
    hua = add(client, trip, "Grandma Hua", paid_by_id=tid(trip, "mei"))
    invite = client.post(f"/api/travelers/{hua['id']}/invite", json={"role": "companion"}, headers=MEI).json()
    assert invite["traveler_id"] == hua["id"]
    roster = client.get(f"/api/trips/{trip.id}/travelers", headers=MEI).json()
    assert next(t for t in roster if t["id"] == hua["id"])["invited"] is True

    HUA = as_user("hua@example.com")
    preview = client.get(f"/api/invites/{invite['token']}", headers=HUA).json()
    assert preview["invite_traveler"]["name"] == "Grandma Hua"
    assert preview["invite_traveler"]["paid_by_name"] == "Mei"

    body = client.post(f"/api/invites/{invite['token']}/accept", headers=HUA).json()
    assert body["my_traveler_id"] == hua["id"]
    db.expire_all()
    assert db.get(TripInvite, invite["id"]).revoked_at is not None
    assert db.query(Traveler).filter(Traveler.trip_id == trip.id).count() == 5


def test_joining_by_general_link_can_claim_pick_or_skip(client, trip, db):
    kai = add(client, trip, "Kai")
    link = client.post(f"/api/trips/{trip.id}/invites", json={"role": "companion"}, headers=MEI).json()["token"]
    preview = client.get(f"/api/invites/{link}", headers=as_user("kai@example.com")).json()
    assert [t["name"] for t in preview["unclaimed_travelers"]] == ["Kai"]

    claimed = client.post(f"/api/invites/{link}/accept", json={"traveler_id": kai["id"]}, headers=as_user("kai@example.com"))
    assert claimed.json()["my_traveler_id"] == kai["id"]
    # Someone else racing for the same traveler loses cleanly.
    late = client.post(f"/api/invites/{link}/accept", json={"traveler_id": kai["id"]}, headers=as_user("imposter@example.com"))
    assert late.status_code == 409

    new = client.post(f"/api/invites/{link}/accept", headers=as_user("zoe@example.com")).json()
    assert new["my_traveler_id"] is not None
    helper = client.post(f"/api/invites/{link}/accept", json={"not_going": True}, headers=as_user("priya@example.com")).json()
    assert helper["my_traveler_id"] is None
    assert db.query(Contributor).filter(Contributor.email == "imposter@example.com").count() == 0


def test_a_new_trip_lists_its_creator_as_a_traveler(client):
    body = client.post("/api/trips", json={"name": "Lisbon"}, headers=as_user("new@example.com")).json()
    assert body["traveler_count"] == 1
    assert body["my_traveler_id"] is not None
