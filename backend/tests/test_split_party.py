"""Split-party plans: the group splitting up for part of a day.

A plan's `party` says who it's for ([] = everyone). Two plans may share
hours only if nobody is on both. See app/party.py.
"""

from app.models import Contest, Plan, Vote

from conftest import as_user, at


def reload(db):
    db.expire_all()


def ids(trip, *keys):
    return sorted(trip.contributors[k].id for k in keys)


def with_party(trip, plan, *keys):
    plan.party = ids(trip, *keys)
    trip.db.commit()
    trip.db.refresh(plan)
    return plan


def place_via_api(client, trip, *, start, end, pin, party=(), user="mei", day=1):
    return client.post(
        f"/api/trips/{trip.id}/plans",
        json={
            "starts_at": at(day, start).isoformat(),
            "ends_at": at(day, end).isoformat(),
            "items": [{"pin_id": trip.pins[pin].id}],
            "party": list(party),
        },
        headers=as_user(f"{user}@example.com"),
    )


def propose(client, trip, *, start, end, stops, party=(), user="jae"):
    return client.post(
        f"/api/trips/{trip.id}/contests",
        json={
            "starts_at": at(1, start).isoformat(),
            "ends_at": at(1, end).isoformat(),
            "items": [{"pin_id": trip.pins[k].id} for k in stops],
            "party": list(party),
        },
        headers=as_user(f"{user}@example.com"),
    )


# ---- the overlap rule ----


def test_plans_for_different_people_can_share_hours(client, trip):
    first = place_via_api(client, trip, start=540, end=720, pin="trail", party=ids(trip, "ana", "lin"))
    assert first.status_code == 201, first.text
    assert first.json()["party"] == ids(trip, "ana", "lin")

    second = place_via_api(client, trip, start=600, end=660, pin="tide", party=ids(trip, "mei", "jae"))
    assert second.status_code == 201, second.text


def test_plans_sharing_a_person_still_collide_and_name_them(client, trip):
    place_via_api(client, trip, start=540, end=720, pin="trail", party=ids(trip, "ana", "lin"))
    res = place_via_api(client, trip, start=600, end=660, pin="tide", party=ids(trip, "lin", "jae"))
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["double_booked"] == ["Lin"]
    assert detail["message"] == "Lin is already on Wild Boy trail loop then."


def test_a_plan_for_everyone_collides_with_any_branch(client, trip):
    place_via_api(client, trip, start=540, end=720, pin="trail", party=ids(trip, "ana"))
    res = place_via_api(client, trip, start=600, end=660, pin="tide")
    assert res.status_code == 409
    assert res.json()["detail"]["double_booked"] == ["Ana"]


def test_a_party_of_the_whole_roster_is_stored_as_everyone(client, trip):
    res = place_via_api(client, trip, start=540, end=600, pin="tide", party=ids(trip, "mei", "jae", "ana", "lin"))
    assert res.status_code == 201
    assert res.json()["party"] == []


def test_a_party_must_be_people_on_the_trip(client, trip):
    res = place_via_api(client, trip, start=540, end=600, pin="tide", party=[99999])
    assert res.status_code == 400


def test_moving_a_branch_only_collides_with_its_own_people(client, trip, db):
    ana_lin = with_party(trip, trip.place(start=540, end=720, pin="trail"), "ana", "lin")
    mei_jae = with_party(trip, trip.place(start=780, end=840, pin="tide"), "mei", "jae")
    res = client.patch(
        f"/api/plans/{mei_jae.id}",
        json={"starts_at": at(1, 600).isoformat(), "ends_at": at(1, 660).isoformat()},
        headers=as_user("mei@example.com"),
    )
    assert res.status_code == 200, res.text
    assert ana_lin.id != mei_jae.id


# ---- splitting ----


def test_split_moves_the_leavers_onto_a_new_plan(client, trip, db):
    plan = trip.place(start=540, end=720, pin="trail")
    res = client.post(
        f"/api/plans/{plan.id}/split",
        json={"leaving": ids(trip, "ana", "lin"), "label": "Taroko Gorge"},
        headers=as_user("jae@example.com"),
    )
    assert res.status_code == 201, res.text
    stayed, branch = res.json()
    assert stayed["id"] == plan.id
    assert stayed["party"] == ids(trip, "mei", "jae")
    assert branch["party"] == ids(trip, "ana", "lin")
    assert branch["label"] == "Taroko Gorge"
    assert branch["items"] == []
    assert branch["starts_at"] == stayed["starts_at"] and branch["ends_at"] == stayed["ends_at"]


def test_split_refuses_leaving_nobody_behind_or_strangers(client, trip):
    plan = with_party(trip, trip.place(start=540, end=720, pin="trail"), "ana", "lin")
    everyone_left = client.post(
        f"/api/plans/{plan.id}/split", json={"leaving": ids(trip, "ana", "lin")}, headers=as_user("mei@example.com")
    )
    assert everyone_left.status_code == 400
    not_on_it = client.post(
        f"/api/plans/{plan.id}/split", json={"leaving": ids(trip, "jae")}, headers=as_user("mei@example.com")
    )
    assert not_on_it.status_code == 400


def test_split_needs_plans_write(client, trip, db):
    trip.jae.role = "companion"
    db.commit()
    plan = trip.place(start=540, end=720, pin="trail")
    res = client.post(f"/api/plans/{plan.id}/split", json={"leaving": ids(trip, "ana")}, headers=as_user("jae@example.com"))
    assert res.status_code == 403


def test_a_plan_in_a_vote_cant_be_split(client, trip):
    trip.place(start=540, end=720, pin="trail")
    contest = propose(client, trip, start=540, end=720, stops=["vase"]).json()
    option = contest["plans"][0]["id"]
    res = client.post(f"/api/plans/{option}/split", json={"leaving": ids(trip, "ana")}, headers=as_user("mei@example.com"))
    assert res.status_code == 409


# ---- changing who a plan is for ----


def test_bringing_a_branch_back_needs_the_other_branch_gone(client, trip, db):
    a = with_party(trip, trip.place(start=540, end=720, pin="trail"), "ana", "lin")
    b = with_party(trip, trip.place(start=600, end=660, pin="tide"), "mei", "jae")
    blocked = client.put(f"/api/plans/{a.id}/party", json={"party": []}, headers=as_user("mei@example.com"))
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["double_booked"] == ["Mei", "Jae"]

    assert client.delete(f"/api/plans/{b.id}", headers=as_user("mei@example.com")).status_code == 204
    ok = client.put(f"/api/plans/{a.id}/party", json={"party": []}, headers=as_user("mei@example.com"))
    assert ok.status_code == 200
    assert ok.json()["party"] == []


def test_a_companion_can_move_themselves_between_branches(client, trip, db):
    trip.jae.role = "companion"
    db.commit()
    gorge = with_party(trip, trip.place(start=540, end=720, pin="trail"), "ana", "lin")
    lake = with_party(trip, trip.place(start=540, end=640, pin="tide"), "mei", "jae")
    beach = with_party(trip, trip.place(start=660, end=720, pin="beach"), "mei", "jae")

    res = client.post(f"/api/plans/{gorge.id}/join", headers=as_user("jae@example.com"))
    assert res.status_code == 200, res.text
    joined, *left = res.json()
    assert joined["party"] == ids(trip, "jae", "ana", "lin")
    assert {p["id"] for p in left} == {lake.id, beach.id}
    assert all(p["party"] == ids(trip, "mei") for p in left)


def test_a_companion_cant_set_anyone_elses_party(client, trip, db):
    trip.jae.role = "companion"
    db.commit()
    plan = with_party(trip, trip.place(start=540, end=720, pin="trail"), "ana")
    res = client.put(f"/api/plans/{plan.id}/party", json={"party": ids(trip, "ana", "lin")}, headers=as_user("jae@example.com"))
    assert res.status_code == 403


def test_joining_refuses_to_leave_a_branch_empty(client, trip):
    gorge = with_party(trip, trip.place(start=540, end=720, pin="trail"), "ana", "lin")
    with_party(trip, trip.place(start=540, end=640, pin="tide"), "jae")
    res = client.post(f"/api/plans/{gorge.id}/join", headers=as_user("jae@example.com"))
    assert res.status_code == 409
    assert "only one" in res.json()["detail"]


def test_joining_a_plan_for_everyone_is_refused(client, trip):
    plan = trip.place(start=540, end=720, pin="trail")
    res = client.post(f"/api/plans/{plan.id}/join", headers=as_user("jae@example.com"))
    assert res.status_code == 409


# ---- votes stay inside a branch ----


def test_a_branch_proposal_captures_only_its_own_plans(client, trip, db):
    gorge = with_party(trip, trip.place(start=540, end=720, pin="trail"), "ana", "lin")
    gorge_id = gorge.id
    lake = with_party(trip, trip.place(start=540, end=640, pin="tide"), "mei", "jae")
    lake_id = lake.id

    res = propose(client, trip, start=540, end=720, stops=["vase"], party=ids(trip, "mei", "jae"))
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["party"] == ids(trip, "mei", "jae")
    assert all(p["party"] == ids(trip, "mei", "jae") for p in body["plans"])
    assert body["contributor_count"] == 2

    reload(db)
    assert db.get(Plan, gorge_id) is not None, "the other branch must never be captured"
    assert db.get(Plan, lake_id) is None


def test_a_whole_group_proposal_over_a_split_is_refused(client, trip):
    with_party(trip, trip.place(start=540, end=720, pin="trail"), "ana", "lin")
    with_party(trip, trip.place(start=540, end=640, pin="tide"), "mei", "jae")
    res = propose(client, trip, start=540, end=720, stops=["vase"])
    assert res.status_code == 409
    assert "Ana and Lin" in res.json()["detail"]["message"]


def test_each_branch_can_run_its_own_vote_over_the_same_hours(client, trip):
    with_party(trip, trip.place(start=540, end=720, pin="trail"), "ana", "lin")
    with_party(trip, trip.place(start=540, end=640, pin="tide"), "mei", "jae")
    first = propose(client, trip, start=540, end=720, stops=["vase"], party=ids(trip, "mei", "jae"))
    second = propose(client, trip, start=540, end=720, stops=["cave"], party=ids(trip, "ana", "lin"), user="ana")
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["id"] != second.json()["id"]


def test_only_the_branch_votes_and_majority_counts_it(client, trip, db):
    with_party(trip, trip.place(start=540, end=640, pin="tide"), "mei", "jae", "ana")
    contest = propose(client, trip, start=540, end=720, stops=["vase"], party=ids(trip, "mei", "jae", "ana")).json()
    option = contest["plans"][1]["id"]

    outsider = client.post(f"/api/contests/{contest['id']}/vote", json={"plan_id": option}, headers=as_user("lin@example.com"))
    assert outsider.status_code == 403

    for who in ("mei", "jae"):
        res = client.post(f"/api/contests/{contest['id']}/vote", json={"plan_id": option}, headers=as_user(f"{who}@example.com"))
        assert res.status_code == 200
    body = res.json()
    assert body["contributor_count"] == 3
    assert body["majority_plan_id"] == option


def test_picking_a_branch_set_keeps_the_branch(client, trip, db):
    with_party(trip, trip.place(start=540, end=640, pin="tide"), "mei", "jae")
    contest = propose(client, trip, start=540, end=720, stops=["vase", "cave"], party=ids(trip, "mei", "jae")).json()
    option = contest["plans"][1]["id"]
    res = client.post(f"/api/contests/{contest['id']}/pick", json={"plan_id": option}, headers=as_user("mei@example.com"))
    assert res.status_code == 200, res.text
    placed = res.json()["placed_plans"]
    assert len(placed) == 2
    assert all(p["party"] == ids(trip, "mei", "jae") for p in placed)


def test_a_branch_draft_publishes_into_a_branch_vote(client, trip):
    with_party(trip, trip.place(start=540, end=720, pin="trail"), "ana", "lin")
    draft = client.post(
        f"/api/trips/{trip.id}/plans",
        json={
            "starts_at": at(1, 540).isoformat(),
            "ends_at": at(1, 720).isoformat(),
            "status": "draft",
            "items": [{"pin_id": trip.pins["vase"].id}],
            "party": ids(trip, "mei", "jae"),
        },
        headers=as_user("mei@example.com"),
    ).json()
    res = client.post(f"/api/plans/{draft['id']}/publish", headers=as_user("mei@example.com"))
    assert res.status_code == 201, res.text
    assert res.json()["party"] == ids(trip, "mei", "jae")


# ---- people leaving the trip ----


def test_removing_someone_collapses_a_branch_only_they_were_on(client, trip, db):
    solo = with_party(trip, trip.place(start=540, end=720, pin="trail"), "lin")
    solo_id = solo.id
    rest = with_party(trip, trip.place(start=540, end=640, pin="tide"), "mei", "jae", "ana")
    rest_id = rest.id

    res = client.delete(f"/api/trips/{trip.id}/contributors/{trip.lin.id}", headers=as_user("mei@example.com"))
    assert res.status_code == 204

    reload(db)
    assert db.get(Plan, solo_id) is None
    # Everyone who's left is on it, so it's simply a plan for everyone now.
    assert db.get(Plan, rest_id).party == []


def test_removing_someone_takes_them_out_of_a_branch_vote(client, trip, db):
    with_party(trip, trip.place(start=540, end=640, pin="tide"), "jae", "ana")
    contest = propose(client, trip, start=540, end=720, stops=["vase"], party=ids(trip, "jae", "ana")).json()
    res = client.delete(f"/api/trips/{trip.id}/contributors/{trip.ana.id}", headers=as_user("mei@example.com"))
    assert res.status_code == 204
    reload(db)
    assert db.get(Contest, contest["id"]).party == ids(trip, "jae")
    assert db.query(Vote).count() == 0
