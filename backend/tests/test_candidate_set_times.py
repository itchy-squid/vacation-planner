"""Adding a candidate to a running decision, and editing one that is
already in it.

Both sit on top of the window contest in test_window_contests.py. Adding a
set is that file's exact-window rule reached on purpose rather than by
coincidence. Editing one is PUT /api/plans/{id}/stops, which takes the same
body a proposal is created with, minus the window — because the screen that
builds a set and the screen that edits a set are the same screen.

Stops now carry their own start times (`offset_minutes`), so a set can hold
deliberate free time. See docs/features/candidate-sets-and-times-spec.md.
"""

from app.models import Contest, PlanStatus, Vote

from conftest import as_user, at


def reload(db):
    db.expire_all()


def stop(trip, key, *, duration=None, offset=None):
    item = {"pin_id": trip.pins[key].id}
    if duration is not None:
        item["duration_minutes"] = duration
    if offset is not None:
        item["offset_minutes"] = offset
    return item


def propose(client, trip, *, day=1, start, end, items, user="jae", label="", rationale=""):
    return client.post(
        f"/api/trips/{trip.id}/contests",
        json={
            "starts_at": at(day, start).isoformat(),
            "ends_at": at(day, end).isoformat(),
            "label": label,
            "rationale": rationale,
            "items": items,
        },
        headers=as_user(f"{user}@example.com"),
    )


def edit(client, plan_id, items, *, user="jae", label="", rationale=""):
    return client.put(
        f"/api/plans/{plan_id}/stops",
        json={"label": label, "rationale": rationale, "items": items},
        headers=as_user(f"{user}@example.com"),
    )


def option(contest_body, letter):
    return next(p for p in contest_body["plans"] if p["set_letter"] == letter)


def starts(plan_body):
    return [i["start_minute_of_day"] for i in sorted(plan_body["items"], key=lambda i: i["position"])]


def titles(plan_body):
    return [
        (i["pin"] or i["travel_item"])["title"]
        for i in sorted(plan_body["items"], key=lambda i: i["position"])
    ]


# --- adding a set to a decision already running ----------------------------


def test_a_third_set_joins_without_recapturing_the_board(client, trip, db):
    """The capture happens once, when the contest opens. A set added
    afterwards is just another option — if it re-ran the capture it would
    fold the existing options into a new incumbent and the decision would
    quietly change shape every time someone joined it."""
    trip.place(start=840, end=900, pin="tide")
    contest_id = propose(client, trip, start=780, end=1080, items=[stop(trip, "vase")]).json()["id"]
    propose(client, trip, start=780, end=1080, items=[stop(trip, "trail")], user="ana")

    body = propose(client, trip, start=780, end=1080, items=[stop(trip, "cave")], user="lin").json()

    assert body["id"] == contest_id
    assert [p["set_letter"] for p in body["plans"]] == ["A", "B", "C", "D"]
    reload(db)
    assert db.query(Contest).count() == 1
    assert titles(option(body, "A")) == ["Meirendong tide pools"]


def test_every_option_spans_the_same_window(client, trip):
    """Which is what makes an added set comparable with the others at all,
    and why editing one never touches its hours."""
    trip.place(start=840, end=900, pin="tide")
    contest_id = propose(client, trip, start=780, end=1080, items=[stop(trip, "vase")]).json()["id"]
    body = propose(client, trip, start=780, end=1080, items=[stop(trip, "trail")], user="ana").json()

    assert body["id"] == contest_id
    assert {(p["starts_at"], p["ends_at"]) for p in body["plans"]} == {(body["starts_at"], body["ends_at"])}


# --- times on a brand new proposal -----------------------------------------


def test_a_new_proposal_can_hold_free_time_between_its_stops(client, trip):
    """Vase Rock (50m) at 13:00 and the trail (80m) at 16:00, with two
    hours of walk in between — something a packed stop list had no way to
    say."""
    body = propose(
        client,
        trip,
        start=780,
        end=1080,
        items=[stop(trip, "vase", offset=0), stop(trip, "trail", offset=180)],
    ).json()
    mine = option(body, "A")

    assert starts(mine) == [780, 960]
    # Slack is the window minus the stops, not minus their span: free time
    # in the middle is unplanned time, which is what slack has always meant
    # (feature spec §2).
    assert mine["slack_minutes"] == 300 - 130


def test_a_proposal_with_no_times_still_packs(client, trip):
    body = propose(client, trip, start=780, end=1080, items=[stop(trip, "vase"), stop(trip, "trail")]).json()
    mine = option(body, "A")

    assert starts(mine) == [780, 830]
    assert [i["offset_minutes"] for i in mine["items"]] == [None, None]


def test_a_new_proposal_that_overruns_its_window_is_refused(client, trip):
    res = propose(client, trip, start=780, end=900, items=[stop(trip, "vase", offset=90)])
    assert res.status_code == 400
    assert res.json()["detail"]["stop_title"] == "Vase Rock"


def test_a_draft_keeps_its_free_time_through_publishing(client, trip):
    """A draft is a whole block someone stepped away from; the shape of it
    has to survive being picked back up."""
    draft = client.post(
        f"/api/trips/{trip.id}/plans",
        json={
            "starts_at": at(1, 780).isoformat(),
            "ends_at": at(1, 1080).isoformat(),
            "status": "draft",
            "items": [stop(trip, "vase", offset=0), stop(trip, "trail", offset=180)],
        },
        headers=as_user("jae@example.com"),
    ).json()
    assert starts(draft) == [780, 960]

    published = client.post(f"/api/plans/{draft['id']}/publish", headers=as_user("jae@example.com")).json()
    assert starts(option(published, "A")) == [780, 960]


# --- editing a candidate already in the vote --------------------------------


def test_editing_moves_the_stops_without_moving_the_window(client, trip):
    body = propose(client, trip, start=780, end=1080, items=[stop(trip, "vase"), stop(trip, "trail")]).json()
    mine = option(body, "A")

    res = edit(client, mine["id"], [stop(trip, "vase", offset=0), stop(trip, "trail", offset=180)])
    assert res.status_code == 200, res.text

    after = option(res.json(), "A")
    assert starts(after) == [780, 960]
    assert (after["starts_at"], after["ends_at"]) == (mine["starts_at"], mine["ends_at"])


def test_editing_can_add_a_stop(client, trip):
    """The thing an edit screen that only knew about times could never
    do — which is why editing reuses the screen that builds a set."""
    body = propose(client, trip, start=780, end=1080, items=[stop(trip, "vase")]).json()
    mine = option(body, "A")

    res = edit(client, mine["id"], [stop(trip, "vase"), stop(trip, "trail"), stop(trip, "ice")])
    assert res.status_code == 200, res.text

    after = option(res.json(), "A")
    assert titles(after) == ["Vase Rock", "Wild Boy trail loop", "Shaved ice"]
    assert starts(after) == [780, 830, 910]


def test_editing_can_remove_a_stop_and_reorder_the_rest(client, trip):
    body = propose(
        client, trip, start=780, end=1080, items=[stop(trip, "vase"), stop(trip, "trail"), stop(trip, "ice")]
    ).json()
    mine = option(body, "A")

    res = edit(client, mine["id"], [stop(trip, "ice"), stop(trip, "vase")])
    assert res.status_code == 200, res.text
    assert titles(option(res.json(), "A")) == ["Shaved ice", "Vase Rock"]


def test_editing_rewrites_the_name_and_the_case_for_it(client, trip):
    body = propose(client, trip, start=780, end=1080, items=[stop(trip, "vase")], label="First go").json()
    mine = option(body, "A")

    res = edit(
        client,
        mine["id"],
        [stop(trip, "vase")],
        label="Ruins first, beach after",
        rationale="The tide is wrong for the pools before four.",
    )
    after = option(res.json(), "A")
    assert after["label"] == "Ruins first, beach after"
    assert after["rationale"] == "The tide is wrong for the pools before four."


def test_a_trim_is_undone_by_sending_the_item_s_own_length(client, trip):
    """`duration_minutes` is an override, and leaving it out is how a
    stop goes back to tracking the pin it came from."""
    body = propose(client, trip, start=780, end=1080, items=[stop(trip, "trail", duration=45)]).json()
    mine = option(body, "A")
    assert mine["items"][0]["duration_minutes"] == 45

    after = option(edit(client, mine["id"], [stop(trip, "trail")]).json(), "A")
    assert after["items"][0]["duration_minutes"] is None
    assert after["total_duration_minutes"] == 80


def test_overlapping_stops_are_refused_by_name(client, trip):
    body = propose(client, trip, start=780, end=1080, items=[stop(trip, "vase")]).json()
    mine = option(body, "A")

    res = edit(client, mine["id"], [stop(trip, "vase", offset=0), stop(trip, "trail", offset=30)])
    assert res.status_code == 400
    detail = res.json()["detail"]
    assert detail["stop_title"] == "Wild Boy trail loop"
    assert "Vase Rock" in detail["message"]


def test_stops_listed_out_of_the_order_they_happen_are_refused(client, trip):
    """A stop with no time of its own follows the stops before it *by
    position*, so a list whose order and times disagree has two answers for
    when it happens."""
    body = propose(client, trip, start=780, end=1080, items=[stop(trip, "vase")]).json()
    mine = option(body, "A")

    res = edit(client, mine["id"], [stop(trip, "vase", offset=180), stop(trip, "trail", offset=0)])
    assert res.status_code == 400


def test_a_stop_may_not_run_past_the_end_of_the_block(client, trip):
    body = propose(client, trip, start=780, end=900, items=[stop(trip, "vase")]).json()
    mine = option(body, "A")

    res = edit(client, mine["id"], [stop(trip, "vase", offset=90)])
    assert res.status_code == 400
    assert res.json()["detail"]["stop_title"] == "Vase Rock"


def test_a_set_may_not_be_emptied_or_hold_the_same_stop_twice(client, trip):
    body = propose(client, trip, start=780, end=1080, items=[stop(trip, "vase")]).json()
    mine = option(body, "A")

    assert edit(client, mine["id"], []).status_code == 422
    assert edit(client, mine["id"], [stop(trip, "vase"), stop(trip, "vase")]).status_code == 400


def test_editing_clears_the_votes_for_that_set_only(client, trip, db):
    """Someone voting for "ruins first, beach after" voted for a list of
    places in an arrangement of hours."""
    trip.place(start=840, end=900, pin="tide")
    body = propose(client, trip, start=780, end=1080, items=[stop(trip, "vase")]).json()
    board, mine = option(body, "A"), option(body, "B")
    trip.vote(body["id"], mine["id"], "ana", "lin")
    trip.vote(body["id"], board["id"], "mei")

    after = edit(client, mine["id"], [stop(trip, "vase", offset=30)]).json()

    assert option(after, "B")["vote_count"] == 0
    assert option(after, "A")["vote_count"] == 1
    assert after["voted_count"] == 1
    reload(db)
    assert db.query(Vote).filter_by(plan_id=mine["id"]).count() == 0


def test_a_majority_recomputes_after_the_votes_it_rested_on_are_cleared(client, trip):
    trip.place(start=840, end=900, pin="tide")
    body = propose(client, trip, start=780, end=1080, items=[stop(trip, "vase")]).json()
    mine = option(body, "B")
    trip.vote(body["id"], mine["id"], "ana", "lin", "mei")
    assert client.get(f"/api/contests/{body['id']}").json()["majority_plan_id"] == mine["id"]

    after = edit(client, mine["id"], [stop(trip, "vase", offset=30)]).json()
    assert after["majority_plan_id"] is None


def test_only_the_proposer_or_the_owner_can_edit_a_set(client, trip):
    body = propose(client, trip, start=780, end=1080, items=[stop(trip, "vase")], user="jae").json()
    mine = option(body, "A")

    assert edit(client, mine["id"], [stop(trip, "vase", offset=30)], user="ana").status_code == 403
    # Mei owns the trip, and can act on any option the same way she can
    # lock any of them.
    assert edit(client, mine["id"], [stop(trip, "vase", offset=30)], user="mei").status_code == 200
    assert edit(client, mine["id"], [stop(trip, "vase", offset=45)], user="jae").status_code == 200


def test_the_set_already_on_the_board_cannot_be_edited(client, trip):
    """The incumbent is not a proposal anyone wrote — it is the board as it
    stood when the hours were claimed. Editing it would change the status
    quo under the people being asked whether to keep it."""
    trip.place(start=840, end=900, pin="tide")
    body = propose(client, trip, start=780, end=1080, items=[stop(trip, "vase")]).json()
    board = option(body, "A")

    res = edit(client, board["id"], [stop(trip, "tide")], user="mei")
    assert res.status_code == 409
    assert "already on the board" in res.json()["detail"]["message"]


def test_a_locked_decision_cannot_be_edited(client, trip):
    trip.place(start=840, end=900, pin="tide")
    body = propose(client, trip, start=780, end=1080, items=[stop(trip, "vase")]).json()
    mine = option(body, "B")
    client.post(
        f"/api/contests/{body['id']}/lock",
        json={"plan_id": mine["id"]},
        headers=as_user("mei@example.com"),
    )

    assert edit(client, mine["id"], [stop(trip, "vase", offset=30)]).status_code == 409


def test_a_placed_plan_is_moved_not_edited(client, trip):
    """This endpoint is only about the options inside a live decision; a
    plan on the board is moved with PATCH /api/plans/{id}."""
    plan = trip.place(start=540, end=600, pin="vase")
    assert edit(client, plan.id, [stop(trip, "vase")]).status_code == 409


def test_an_edited_set_keeps_its_shape_through_a_lock(client, trip, db):
    """The winning option keeps its times when it goes onto the board, so
    the day people agreed to is the day the calendar then shows."""
    body = propose(client, trip, start=780, end=1080, items=[stop(trip, "vase")]).json()
    mine = option(body, "A")
    edit(client, mine["id"], [stop(trip, "vase", offset=0), stop(trip, "trail", offset=180)])
    client.post(
        f"/api/contests/{body['id']}/lock",
        json={"plan_id": mine["id"]},
        headers=as_user("mei@example.com"),
    )

    reload(db)
    plan = client.get(f"/api/plans/{mine['id']}").json()
    assert plan["status"] == PlanStatus.locked.value
    assert starts(plan) == [780, 960]
