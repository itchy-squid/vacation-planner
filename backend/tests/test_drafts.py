"""Draft blocks — the app's first per-contributor read filter.

A draft is a plan its author hasn't shown anyone: invisible to everyone
else, occupying no time, and publishable into a real proposal. See
docs/features/proposals-and-expenses-feature-spec.md §6.4.
"""

from app.models import Plan, PlanStatus

from conftest import as_user, at


def make_draft(client, trip, *, day=1, start=780, end=1080, stops=("vase",), user="jae", label=""):
    return client.post(
        f"/api/trips/{trip.id}/plans",
        json={
            "starts_at": at(day, start).isoformat(),
            "ends_at": at(day, end).isoformat(),
            "status": "draft",
            "label": label,
            "items": [{"pin_id": trip.pins[key].id} for key in stops],
        },
        headers=as_user(f"{user}@example.com"),
    )


def test_a_draft_is_invisible_to_everyone_but_its_author(client, trip):
    created = make_draft(client, trip, user="jae", label="Jae's idea")
    assert created.status_code == 201, created.text
    draft_id = created.json()["id"]

    mine = client.get(f"/api/trips/{trip.id}/plans", headers=as_user("jae@example.com"))
    assert [p["id"] for p in mine.json()] == [draft_id]

    theirs = client.get(f"/api/trips/{trip.id}/plans", headers=as_user("ana@example.com"))
    assert theirs.json() == []


def test_getting_someone_elses_draft_is_a_404(client, trip):
    draft_id = make_draft(client, trip, user="jae").json()["id"]

    assert client.get(f"/api/plans/{draft_id}", headers=as_user("jae@example.com")).status_code == 200
    # 404 rather than 403 — someone else's draft shouldn't even confirm
    # that a plan exists at that id.
    assert client.get(f"/api/plans/{draft_id}", headers=as_user("ana@example.com")).status_code == 404


def test_a_draft_occupies_no_time(client, trip):
    """The whole point: a private draft nobody can see must not be able to
    silently block anyone else's placement."""
    make_draft(client, trip, start=780, end=1080, user="jae")

    placed = client.post(
        f"/api/trips/{trip.id}/plans",
        json={
            "starts_at": at(1, 840).isoformat(),
            "ends_at": at(1, 900).isoformat(),
            "status": "placed",
            "items": [{"pin_id": trip.pins["tide"].id}],
        },
        headers=as_user("ana@example.com"),
    )
    assert placed.status_code == 201, placed.text


def test_a_draft_is_not_captured_by_someone_elses_proposal(client, trip, db):
    """Capture deletes what it sweeps up. A draft the proposer can't even
    see must not be among it."""
    draft_id = make_draft(client, trip, start=840, end=900, user="jae").json()["id"]

    res = client.post(
        f"/api/trips/{trip.id}/contests",
        json={
            "starts_at": at(1, 780).isoformat(),
            "ends_at": at(1, 1080).isoformat(),
            "items": [{"pin_id": trip.pins["trail"].id}],
        },
        headers=as_user("ana@example.com"),
    )
    assert res.status_code == 201, res.text
    # One option only: there was nothing visible on the board to capture.
    assert len(res.json()["plans"]) == 1

    db.expire_all()
    survivor = db.get(Plan, draft_id)
    assert survivor is not None and survivor.status == PlanStatus.draft


def test_publishing_a_draft_turns_it_into_a_proposal(client, trip, db):
    trip.place(start=840, end=900, pin="tide")
    draft_id = make_draft(client, trip, start=780, end=1080, stops=("vase", "ice"), user="jae", label="Mine").json()["id"]

    res = client.post(f"/api/plans/{draft_id}/publish", headers=as_user("jae@example.com"))
    assert res.status_code == 201, res.text
    body = res.json()

    assert [p["set_letter"] for p in body["plans"]] == ["A", "B"]
    proposal = body["plans"][-1]
    assert proposal["label"] == "Mine"
    assert [i["pin"]["title"] for i in proposal["items"]] == ["Vase Rock", "Shaved ice"]

    # The draft itself is consumed, not left behind as a second copy.
    db.expire_all()
    assert db.get(Plan, draft_id) is None


def test_only_the_author_can_publish_a_draft(client, trip):
    draft_id = make_draft(client, trip, user="jae").json()["id"]
    assert client.post(f"/api/plans/{draft_id}/publish", headers=as_user("ana@example.com")).status_code == 404


def test_publishing_into_hours_that_went_to_a_vote_409s(client, trip):
    """The race the flow actually has to survive: a draft sits unpublished
    while someone else claims overlapping hours."""
    trip.place(start=840, end=900, pin="tide")
    draft_id = make_draft(client, trip, start=780, end=1080, user="jae").json()["id"]

    taken = client.post(
        f"/api/trips/{trip.id}/contests",
        json={
            "starts_at": at(1, 900).isoformat(),
            "ends_at": at(1, 1200).isoformat(),
            "items": [{"pin_id": trip.pins["trail"].id}],
        },
        headers=as_user("ana@example.com"),
    )
    assert taken.status_code == 201, taken.text

    res = client.post(f"/api/plans/{draft_id}/publish", headers=as_user("jae@example.com"))
    assert res.status_code == 409
    assert res.json()["detail"]["contest_id"] == taken.json()["id"]


def test_deleting_a_pin_in_someone_elses_draft_names_the_draft(client, trip):
    """The author may be someone else and the plan is invisible to the
    caller, so "it's scheduled somewhere" would be a dead end."""
    make_draft(client, trip, stops=("vase",), user="jae")

    res = client.delete(f"/api/pins/{trip.pins['vase'].id}", headers=as_user("ana@example.com"))
    assert res.status_code == 409
    assert "Jae's draft block" in res.json()["detail"]


def test_an_author_can_discard_their_own_draft(client, trip, db):
    draft_id = make_draft(client, trip, user="jae").json()["id"]

    assert client.delete(f"/api/plans/{draft_id}", headers=as_user("ana@example.com")).status_code == 404
    assert client.delete(f"/api/plans/{draft_id}", headers=as_user("jae@example.com")).status_code == 204

    db.expire_all()
    assert db.get(Plan, draft_id) is None
