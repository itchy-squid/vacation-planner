"""The group splitting up: Split / SplitBranch and the rules in app/splits.py.

The fixture trip has four travelers — Mei, Jae, Ana and Lin — each linked
to the member of the same name. `trip.split(...)` writes a split straight
into the database; the API tests below build theirs through the endpoints.
"""

import pytest

from app.models import Contest, Plan, PlanStatus, Split, SplitBranch, TravelItem

from conftest import as_user, at

MEI = as_user("mei@example.com")
JAE = as_user("jae@example.com")
ANA = as_user("ana@example.com")


def ids(trip, *keys):
    return sorted(trip.travelers[k].id for k in keys)


def reload(db):
    db.expire_all()


def place(client, trip, *, start, end, pin, branch=None, user=MEI, day=1):
    return client.post(
        f"/api/trips/{trip.id}/plans",
        json={
            "starts_at": at(day, start).isoformat(),
            "ends_at": at(day, end).isoformat(),
            "items": [{"pin_id": trip.pins[pin].id}],
            "branch_id": branch.id if branch else None,
        },
        headers=user,
    )


def propose(client, trip, *, start, end, stops, branch=None, user=JAE):
    return client.post(
        f"/api/trips/{trip.id}/contests",
        json={
            "starts_at": at(1, start).isoformat(),
            "ends_at": at(1, end).isoformat(),
            "items": [{"pin_id": trip.pins[k].id} for k in stops],
            "branch_id": branch.id if branch else None,
        },
        headers=user,
    )


def create_split(client, trip, *, start, end, groups, keep_plans_with=0, newcomers=None, user=MEI):
    return client.post(
        f"/api/trips/{trip.id}/splits",
        json={
            "starts_at": at(1, start).isoformat(),
            "ends_at": at(1, end).isoformat(),
            "branches": [
                {"traveler_ids": ids(trip, *keys), "label": label, "takes_newcomers": newcomers == i}
                for i, (label, keys) in enumerate(groups)
            ],
            "keep_plans_with": keep_plans_with,
        },
        headers=user,
    )


def reshape(client, split_id, branches, user=MEI):
    return client.put(f"/api/splits/{split_id}", json={"branches": branches}, headers=user)


def retime(client, split_id, *, start, end, user=MEI):
    return client.put(
        f"/api/splits/{split_id}/hours",
        json={"starts_at": at(1, start).isoformat(), "ends_at": at(1, end).isoformat()},
        headers=user,
    )


# ---- where plans may go ----


def test_each_group_has_its_own_calendar_over_the_same_hours(client, trip):
    gorge, lake = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    first = place(client, trip, start=540, end=720, pin="trail", branch=gorge)
    assert first.status_code == 201, first.text
    assert first.json()["branch_id"] == gorge.id
    assert first.json()["party_members"] == ids(trip, "ana", "lin")
    assert first.json()["for_everyone"] is False

    second = place(client, trip, start=540, end=600, pin="tide", branch=lake)
    assert second.status_code == 201, second.text


def test_plans_in_one_group_still_collide_and_name_who_is_busy(client, trip):
    gorge, _ = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    trip.place(start=540, end=720, pin="trail", branch=gorge)
    res = place(client, trip, start=600, end=660, pin="tide", branch=gorge)
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["double_booked"] == ["Ana", "Lin"]
    assert detail["message"] == "Ana and Lin are already on Wild Boy trail loop then."


def test_a_plan_for_everyone_stays_out_of_split_hours(client, trip):
    trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    res = place(client, trip, start=700, end=760, pin="tide")
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["split_id"] is not None
    assert "08:00–12:00" in detail["message"]
    # Right after the split ends is fine: touching edges don't overlap.
    assert place(client, trip, start=720, end=780, pin="tide").status_code == 201


def test_a_groups_plan_stays_inside_its_split(client, trip):
    gorge, _ = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720, labels=("Taroko Gorge",))
    res = place(client, trip, start=660, end=780, pin="trail", branch=gorge)
    assert res.status_code == 409
    assert res.json()["detail"]["message"] == "Plans for Taroko Gorge have to fit inside the split, 08:00–12:00."


def test_a_group_from_another_trip_is_refused(client, trip, db):
    other = Split(trip_id=trip.id + 1000, starts_at=at(1, 480), ends_at=at(1, 720))
    other.branches.append(SplitBranch(traveler_ids=[], position=0))
    db.add(other)
    db.commit()
    res = place(client, trip, start=540, end=600, pin="tide", branch=other.branches[0])
    assert res.status_code == 400


def test_moving_a_groups_plan_only_meets_its_own_group(client, trip):
    gorge, lake = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    trip.place(start=540, end=720, pin="trail", branch=gorge)
    swim = trip.place(start=480, end=540, pin="tide", branch=lake)
    moved = client.patch(
        f"/api/plans/{swim.id}",
        json={"starts_at": at(1, 600).isoformat(), "ends_at": at(1, 660).isoformat()},
        headers=MEI,
    )
    assert moved.status_code == 200, moved.text
    out_of_split = client.patch(
        f"/api/plans/{swim.id}",
        json={"starts_at": at(1, 700).isoformat(), "ends_at": at(1, 760).isoformat()},
        headers=MEI,
    )
    assert out_of_split.status_code == 409


def test_unplacing_a_groups_plan_removes_it_and_keeps_the_group(client, trip, db):
    gorge, _ = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    ferry = trip.place(start=540, end=720, travel_item="ferry", branch=gorge)
    ferry_id, item_id, gorge_id = ferry.id, trip.travel_items["ferry"].id, gorge.id
    assert client.delete(f"/api/plans/{ferry_id}", headers=MEI).status_code == 204
    reload(db)
    assert db.get(Plan, ferry_id) is None
    assert db.get(TravelItem, item_id) is None
    # The group is still there to plan for again.
    assert db.get(SplitBranch, gorge_id) is not None
    assert place(client, trip, start=540, end=720, pin="tide", branch=db.get(SplitBranch, gorge_id)).status_code == 201


# ---- splitting ----


def test_splitting_over_a_plan_keeps_it_with_the_group_that_stays(client, trip, db):
    plan = trip.place(start=540, end=720, pin="trail")
    res = create_split(
        client, trip, start=540, end=720,
        groups=[("", ("mei", "jae")), ("Taroko Gorge", ("ana", "lin"))],
        newcomers=1,
    )
    assert res.status_code == 201, res.text
    body = res.json()
    stay, leave = body["branches"]
    assert stay["traveler_ids"] == ids(trip, "mei", "jae")
    assert leave == {
        "id": leave["id"], "label": "Taroko Gorge", "position": 1,
        "traveler_ids": ids(trip, "ana", "lin"), "takes_newcomers": True,
    }
    reload(db)
    assert db.get(Plan, plan.id).branch_id == stay["id"]

    listed = client.get(f"/api/trips/{trip.id}/splits", headers=MEI).json()
    assert [s["id"] for s in listed] == [body["id"]]


@pytest.mark.parametrize(
    "groups, reason",
    [
        ([("", ("mei", "jae", "ana", "lin"))], "at least two"),
        ([("", ("mei", "jae")), ("", ("jae", "ana"))], "Jae can't be in two groups"),
    ],
)
def test_split_groups_have_to_make_sense(client, trip, groups, reason):
    res = create_split(client, trip, start=540, end=720, groups=groups)
    assert res.status_code in (400, 422)
    if res.status_code == 400:
        assert reason in res.json()["detail"]


def test_only_one_group_takes_newcomers(client, trip):
    res = client.post(
        f"/api/trips/{trip.id}/splits",
        json={
            "starts_at": at(1, 540).isoformat(), "ends_at": at(1, 720).isoformat(),
            "branches": [
                {"traveler_ids": ids(trip, "mei"), "takes_newcomers": True},
                {"traveler_ids": ids(trip, "ana"), "takes_newcomers": True},
            ],
        },
        headers=MEI,
    )
    assert res.status_code == 400


def test_a_split_can_leave_someone_free(client, trip):
    res = create_split(client, trip, start=540, end=720, groups=[("", ("mei",)), ("", ("ana",))])
    assert res.status_code == 201, res.text


def test_splitting_across_part_of_a_plan_is_refused(client, trip):
    trip.place(start=600, end=780, pin="trail")
    res = create_split(client, trip, start=540, end=720, groups=[("", ("mei", "jae")), ("", ("ana", "lin"))])
    assert res.status_code == 409
    assert "past the hours being split" in res.json()["detail"]["message"]


def test_splitting_over_a_vote_or_a_pinned_plan_is_refused(client, trip):
    trip.place(start=540, end=600, pin="ice", status=PlanStatus.locked)
    pinned = create_split(client, trip, start=540, end=720, groups=[("", ("mei", "jae")), ("", ("ana", "lin"))])
    assert pinned.status_code == 409
    assert "pinned" in pinned.json()["detail"]

    trip.place(start=780, end=840, pin="trail")
    assert propose(client, trip, start=780, end=840, stops=["vase"]).status_code == 201
    voting = create_split(client, trip, start=780, end=900, groups=[("", ("mei", "jae")), ("", ("ana", "lin"))])
    assert voting.status_code == 409
    assert "vote" in voting.json()["detail"]


def test_splits_dont_overlap(client, trip):
    trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    res = create_split(client, trip, start=660, end=780, groups=[("", ("mei",)), ("", ("ana",))])
    assert res.status_code == 409


def test_splitting_needs_plans_write(client, trip, db):
    trip.jae.role = "companion"
    db.commit()
    res = create_split(client, trip, start=540, end=720, groups=[("", ("mei",)), ("", ("ana",))], user=JAE)
    assert res.status_code == 403


# ---- changing a split's hours ----


def test_a_splits_hours_grow_and_shrink_around_its_groups_plans(client, trip, db):
    gorge, lake = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    hike = trip.place(start=540, end=620, pin="trail", branch=gorge)
    hike_id, split_id = hike.id, gorge.split_id

    grown = retime(client, split_id, start=420, end=780)
    assert grown.status_code == 200, grown.text
    assert grown.json()["starts_at"].startswith("2026-10-03T07:00")
    assert grown.json()["ends_at"].startswith("2026-10-03T13:00")
    # The new hours are the groups' to plan in.
    assert place(client, trip, start=720, end=780, pin="tide", branch=lake).status_code == 201

    shrunk = retime(client, split_id, start=540, end=780)
    assert shrunk.status_code == 200, shrunk.text
    reload(db)
    assert db.get(Plan, hike_id).branch_id == gorge.id, "nothing changes hands"
    # And the hours given back are everyone's again.
    assert place(client, trip, start=480, end=540, pin="ice").status_code == 201


def test_a_split_cant_shrink_past_a_groups_plan(client, trip):
    gorge, _ = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720, labels=("Taroko Gorge",))
    hike = trip.place(start=540, end=660, pin="trail", branch=gorge)
    res = retime(client, gorge.split_id, start=480, end=600)
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["plan_id"] == hike.id
    assert detail["message"] == "Wild Boy trail loop for Taroko Gorge runs 09:00–11:00, outside those hours. Move it first."


def test_a_split_cant_shrink_past_a_groups_vote(client, trip):
    _, lake = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    vote = propose(client, trip, start=540, end=720, stops=["vase"], branch=lake)
    assert vote.status_code == 201, vote.text
    res = retime(client, lake.split_id, start=480, end=660)
    assert res.status_code == 409
    assert res.json()["detail"]["message"] == (
        "There's a vote in progress for Mei and Jae from 09:00–12:00, outside those hours. Settle it first."
    )


def test_a_split_cant_take_in_a_plan_for_everyone(client, trip):
    gorge, _ = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    lunch = trip.place(start=720, end=780, pin="ice")
    res = retime(client, gorge.split_id, start=480, end=750)
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["plan_id"] == lunch.id
    assert detail["message"] == "Shaved ice for everyone runs 12:00–13:00, inside those hours. Move it first."


def test_a_split_cant_take_in_a_vote_for_everyone(client, trip):
    gorge, _ = trip.split(("ana", "lin"), ("mei", "jae"), start=1100, end=1200)
    vote = propose(client, trip, start=780, end=1080, stops=["vase"])
    assert vote.status_code == 201, vote.text
    res = retime(client, gorge.split_id, start=1000, end=1200)
    assert res.status_code == 409
    assert res.json()["detail"]["message"].startswith("There's a vote in progress for everyone from 13:00–18:00")


def test_a_split_cant_grow_into_another(client, trip):
    first, _ = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=600)
    second, _ = trip.split(("ana",), ("mei",), start=720, end=840)
    res = retime(client, first.split_id, start=480, end=780)
    assert res.status_code == 409
    assert res.json()["detail"]["split_id"] == second.split_id
    # Meeting it edge to edge is fine.
    assert retime(client, first.split_id, start=480, end=720).status_code == 200


def test_a_split_has_to_end_after_it_starts(client, trip):
    gorge, _ = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    assert retime(client, gorge.split_id, start=600, end=600).status_code == 400


def test_changing_a_splits_hours_needs_plans_write(client, trip, db):
    gorge, _ = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    trip.jae.role = "companion"
    db.commit()
    assert retime(client, gorge.split_id, start=480, end=780, user=JAE).status_code == 403


# ---- who is in which group ----


def test_moving_someone_between_groups_is_one_change(client, trip):
    gorge, lake = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    res = reshape(
        client, gorge.split_id,
        [
            {"id": gorge.id, "label": "Gorge", "traveler_ids": ids(trip, "ana", "lin", "jae")},
            {"id": lake.id, "traveler_ids": ids(trip, "mei"), "takes_newcomers": True},
        ],
    )
    assert res.status_code == 200, res.text
    first, second = res.json()["branches"]
    assert first["label"] == "Gorge" and first["traveler_ids"] == ids(trip, "jae", "ana", "lin")
    assert second["traveler_ids"] == ids(trip, "mei") and second["takes_newcomers"] is True


def test_a_group_with_plans_cant_just_be_dropped(client, trip, db):
    gorge, lake, beach = trip.split(("ana",), ("mei", "jae"), ("lin",), start=480, end=720)
    trip.place(start=540, end=600, pin="trail", branch=beach)
    keep_two = [
        {"id": gorge.id, "traveler_ids": ids(trip, "ana", "lin")},
        {"id": lake.id, "traveler_ids": ids(trip, "mei", "jae")},
    ]
    assert reshape(client, gorge.split_id, keep_two).status_code == 409

    empty = trip.split(("ana",), ("mei",), ("lin",), day=2, start=480, end=720)
    res = reshape(
        client, empty[0].split_id,
        [{"id": empty[0].id, "traveler_ids": ids(trip, "ana", "lin")}, {"id": empty[1].id, "traveler_ids": ids(trip, "mei")}],
    )
    assert res.status_code == 200, res.text
    assert len(res.json()["branches"]) == 2


def test_leaving_a_group_takes_your_vote_on_its_decision_with_you(client, trip, db):
    gorge, lake = trip.split(("ana", "lin", "jae"), ("mei",), start=480, end=720)
    trip.place(start=540, end=600, pin="trail", branch=gorge)
    contest = propose(client, trip, start=540, end=660, stops=["vase"], branch=gorge).json()
    option = contest["plans"][1]["id"]
    assert client.post(f"/api/contests/{contest['id']}/vote", json={"plan_id": option}, headers=JAE).status_code == 200

    reshape(
        client, gorge.split_id,
        [{"id": gorge.id, "traveler_ids": ids(trip, "ana", "lin")}, {"id": lake.id, "traveler_ids": ids(trip, "mei", "jae")}],
    )
    body = client.get(f"/api/contests/{contest['id']}", headers=MEI).json()
    assert body["voted_count"] == 0
    assert body["contributor_count"] == 2


# ---- moving yourself ----


def test_a_companion_can_move_themselves_into_another_group(client, trip, db):
    trip.jae.role = "companion"
    db.commit()
    gorge, lake = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    res = client.post(f"/api/branches/{gorge.id}/join", headers=JAE)
    assert res.status_code == 200, res.text
    first, second = res.json()["branches"]
    assert first["traveler_ids"] == ids(trip, "jae", "ana", "lin")
    assert second["traveler_ids"] == ids(trip, "mei")


def test_moving_out_of_a_group_that_has_plans_and_nobody_else_is_refused(client, trip):
    gorge, solo = trip.split(("ana", "lin", "mei"), ("jae",), start=480, end=720)
    trip.place(start=540, end=600, pin="tide", branch=solo)
    res = client.post(f"/api/branches/{gorge.id}/join", headers=JAE)
    assert res.status_code == 409
    assert "only one" in res.json()["detail"]


def test_emptying_the_last_other_group_ends_the_split(client, trip, db):
    gorge, solo = trip.split(("ana", "lin", "mei"), ("jae",), start=480, end=720)
    hike = trip.place(start=540, end=720, pin="trail", branch=gorge)
    split_id, hike_id = gorge.split_id, hike.id
    res = client.post(f"/api/branches/{gorge.id}/join", headers=JAE)
    assert res.status_code == 200, res.text
    assert res.json() is None
    reload(db)
    assert db.get(Split, split_id) is None
    assert db.get(Plan, hike_id).branch_id is None


def test_someone_who_isnt_going_cant_join_a_group(client, trip):
    gorge, _ = trip.split(("ana", "lin"), ("mei",), start=480, end=720)
    assert client.delete(f"/api/travelers/{trip.travelers['jae'].id}", headers=MEI).status_code == 204
    assert client.post(f"/api/branches/{gorge.id}/join", headers=JAE).status_code == 409


# ---- bringing everyone back ----


def test_bringing_everyone_back_keeps_one_groups_day(client, trip, db):
    gorge, lake = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    hike = trip.place(start=540, end=720, pin="trail", branch=gorge)
    ferry = trip.place(start=480, end=540, travel_item="ferry", branch=lake)
    swim = trip.place(start=600, end=660, pin="tide", branch=lake)
    split_id, hike_id, ferry_id, swim_id = gorge.split_id, hike.id, ferry.id, swim.id
    ferry_item = trip.travel_items["ferry"].id

    res = client.post(f"/api/splits/{split_id}/merge", json={"keep_branch_id": gorge.id}, headers=MEI)
    assert res.status_code == 204, res.text

    reload(db)
    assert db.get(Split, split_id) is None
    assert db.get(Plan, hike_id).branch_id is None
    assert db.get(Plan, ferry_id) is None and db.get(Plan, swim_id) is None
    # A custom event only the other group used goes, like any unplace.
    assert db.get(TravelItem, ferry_item) is None
    # The hours are everyone's again.
    assert place(client, trip, start=480, end=540, pin="vase").status_code == 201


def test_bringing_everyone_back_stops_at_a_pinned_plan_or_a_vote(client, trip):
    gorge, lake = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    trip.place(start=480, end=540, pin="ice", status=PlanStatus.locked, branch=lake)
    pinned = client.post(f"/api/splits/{gorge.split_id}/merge", json={"keep_branch_id": gorge.id}, headers=MEI)
    assert pinned.status_code == 409
    assert "pinned" in pinned.json()["detail"]

    trip.place(start=600, end=660, pin="trail", branch=gorge)
    assert propose(client, trip, start=600, end=660, stops=["cave"], branch=gorge).status_code == 201
    voting = client.post(f"/api/splits/{gorge.split_id}/merge", json={"keep_branch_id": lake.id}, headers=MEI)
    assert voting.status_code == 409
    assert "vote" in voting.json()["detail"]


def test_bringing_everyone_back_needs_plans_write(client, trip, db):
    trip.jae.role = "companion"
    db.commit()
    gorge, _ = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    res = client.post(f"/api/splits/{gorge.split_id}/merge", json={"keep_branch_id": gorge.id}, headers=JAE)
    assert res.status_code == 403


# ---- votes stay inside a group ----


def test_a_groups_proposal_captures_only_its_own_plans(client, trip, db):
    gorge, lake = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    hike = trip.place(start=540, end=720, pin="trail", branch=gorge)
    swim = trip.place(start=540, end=640, pin="tide", branch=lake)
    hike_id, swim_id = hike.id, swim.id

    res = propose(client, trip, start=540, end=720, stops=["vase"], branch=lake)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["branch_id"] == lake.id
    assert body["party_members"] == ids(trip, "mei", "jae")
    assert all(p["branch_id"] == lake.id for p in body["plans"])
    assert body["contributor_count"] == 2

    reload(db)
    assert db.get(Plan, hike_id) is not None, "the other group must never be captured"
    assert db.get(Plan, swim_id) is None


def test_a_whole_group_proposal_over_split_hours_is_refused(client, trip):
    trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    res = propose(client, trip, start=540, end=720, stops=["vase"])
    assert res.status_code == 409
    assert "split up" in res.json()["detail"]["message"]


def test_each_group_can_run_its_own_vote_over_the_same_hours(client, trip):
    gorge, lake = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    trip.place(start=540, end=720, pin="trail", branch=gorge)
    trip.place(start=540, end=640, pin="tide", branch=lake)
    first = propose(client, trip, start=540, end=720, stops=["vase"], branch=lake)
    second = propose(client, trip, start=540, end=720, stops=["cave"], branch=gorge, user=ANA)
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["id"] != second.json()["id"]


def test_only_the_group_votes_and_the_majority_is_theirs(client, trip):
    group, _ = trip.split(("mei", "jae", "ana"), ("lin",), start=480, end=720)
    trip.place(start=540, end=640, pin="tide", branch=group)
    contest = propose(client, trip, start=540, end=720, stops=["vase"], branch=group).json()
    option = contest["plans"][1]["id"]

    outsider = client.post(f"/api/contests/{contest['id']}/vote", json={"plan_id": option}, headers=as_user("lin@example.com"))
    assert outsider.status_code == 403

    for who in ("mei", "jae"):
        res = client.post(f"/api/contests/{contest['id']}/vote", json={"plan_id": option}, headers=as_user(f"{who}@example.com"))
        assert res.status_code == 200
    body = res.json()
    assert body["contributor_count"] == 3
    assert body["majority_plan_id"] == option


def test_picking_a_groups_set_keeps_it_in_the_group(client, trip):
    _, lake = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    trip.place(start=540, end=640, pin="tide", branch=lake)
    contest = propose(client, trip, start=540, end=720, stops=["vase", "cave"], branch=lake).json()
    option = contest["plans"][1]["id"]
    res = client.post(f"/api/contests/{contest['id']}/pick", json={"plan_id": option}, headers=MEI)
    assert res.status_code == 200, res.text
    placed = res.json()["placed_plans"]
    assert len(placed) == 2
    assert all(p["branch_id"] == lake.id for p in placed)


def test_a_groups_draft_publishes_into_the_groups_vote(client, trip):
    gorge, lake = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    trip.place(start=540, end=720, pin="trail", branch=gorge)
    draft = client.post(
        f"/api/trips/{trip.id}/plans",
        json={
            "starts_at": at(1, 540).isoformat(),
            "ends_at": at(1, 720).isoformat(),
            "status": "draft",
            "items": [{"pin_id": trip.pins["vase"].id}],
            "branch_id": lake.id,
        },
        headers=MEI,
    ).json()
    assert draft["branch_id"] == lake.id
    res = client.post(f"/api/plans/{draft['id']}/publish", headers=MEI)
    assert res.status_code == 201, res.text
    assert res.json()["branch_id"] == lake.id


# ---- travelers joining and leaving the trip ----


def test_someone_added_later_joins_the_group_that_takes_newcomers(client, trip):
    gorge, lake = trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720, newcomers=0)
    kai = client.post(f"/api/trips/{trip.id}/travelers", json={"name": "Kai"}, headers=MEI).json()
    first, second = client.get(f"/api/trips/{trip.id}/splits", headers=MEI).json()[0]["branches"]
    assert kai["id"] in first["traveler_ids"]
    assert kai["id"] not in second["traveler_ids"]


def test_without_a_newcomers_group_someone_added_later_is_free(client, trip):
    trip.split(("ana", "lin"), ("mei", "jae"), start=480, end=720)
    kai = client.post(f"/api/trips/{trip.id}/travelers", json={"name": "Kai"}, headers=MEI).json()
    branches = client.get(f"/api/trips/{trip.id}/splits", headers=MEI).json()[0]["branches"]
    assert all(kai["id"] not in b["traveler_ids"] for b in branches)


def test_removing_the_only_traveler_in_a_group_ends_the_split(client, trip, db):
    solo, rest = trip.split(("lin",), ("mei", "jae", "ana"), start=480, end=720)
    hike = trip.place(start=540, end=720, pin="trail", branch=solo)
    swim = trip.place(start=540, end=640, pin="tide", branch=rest)
    split_id, hike_id, swim_id = solo.split_id, hike.id, swim.id

    res = client.delete(f"/api/travelers/{trip.travelers['lin'].id}", headers=MEI)
    assert res.status_code == 204

    reload(db)
    assert db.get(Plan, hike_id) is None
    assert db.get(Split, split_id) is None
    # Everyone who's left was on it, so it's simply a plan for everyone now.
    assert db.get(Plan, swim_id).branch_id is None


def test_removing_a_traveler_keeps_their_groups_vote_for_the_rest(client, trip, db):
    group, _ = trip.split(("jae", "ana"), ("mei", "lin"), start=480, end=720)
    trip.place(start=540, end=640, pin="tide", branch=group)
    contest = propose(client, trip, start=540, end=720, stops=["vase"], branch=group).json()
    res = client.delete(f"/api/travelers/{trip.travelers['ana'].id}", headers=MEI)
    assert res.status_code == 204
    reload(db)
    assert db.get(Contest, contest["id"]).branch_id == group.id
    assert db.get(SplitBranch, group.id).traveler_ids == ids(trip, "jae")


def test_a_member_leaving_the_app_stays_in_their_group(client, trip, db):
    """Removing a member unlinks their traveler; they're still going."""
    group, _ = trip.split(("lin",), ("mei", "jae", "ana"), start=480, end=720)
    res = client.delete(f"/api/trips/{trip.id}/contributors/{trip.lin.id}", headers=MEI)
    assert res.status_code == 204
    reload(db)
    assert db.get(SplitBranch, group.id).traveler_ids == ids(trip, "lin")
