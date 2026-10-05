"""People you've planned with, and inviting them straight into a new trip.

See routers/people.py (the list), routers/trips.py create_trip (the
invites) and routers/sharing.py (waiting invites, accepting, declining).
The fixture trip is Mei's Taiwan, with Jae, Ana and Lin on it.
"""

from datetime import date

from app.models import Contributor, Traveler, Trip, TripInvite

from conftest import as_user

MEI = as_user("mei@example.com")
JAE = as_user("jae@example.com")
ANA = as_user("ana@example.com")
STRANGER = as_user("zoe@example.com")


def new_trip(client, invitees=(), headers=MEI):
    res = client.post(
        "/api/trips",
        json={"name": "Japan", "start_date": "2027-04-03", "invitees": list(invitees)},
        headers=headers,
    )
    return res


def invites_for(client, headers):
    res = client.get("/api/me/invites", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


# ---- the list ----


def test_people_are_everyone_you_share_a_trip_with(client, trip):
    people = client.get("/api/people", headers=MEI).json()
    assert sorted(p["email"] for p in people) == ["ana@example.com", "jae@example.com", "lin@example.com"]
    jae = next(p for p in people if p["email"] == "jae@example.com")
    assert jae["display_name"] == "Jae"
    assert jae["last_role"] == "planner"
    assert [t["name"] for t in jae["trips"]] == ["Taiwan"]


def test_someone_on_no_trip_with_you_isnt_listed(client, trip):
    assert client.get("/api/people", headers=STRANGER).json() == []


def test_most_recent_trip_first_and_its_role_suggested(client, trip, db):
    later = Trip(name="Peru", start_date=date(2027, 3, 1))
    db.add(later)
    db.flush()
    db.add(Contributor(trip_id=later.id, email="mei@example.com", display_name="Mei", initial="M", role="owner"))
    db.add(Contributor(trip_id=later.id, email="ana@example.com", display_name="Ana", initial="A", role="reader"))
    db.commit()

    people = client.get("/api/people", headers=MEI).json()
    assert people[0]["email"] == "ana@example.com"
    assert people[0]["last_role"] == "reader"
    assert [t["name"] for t in people[0]["trips"]] == ["Peru", "Taiwan"]


# ---- inviting from a new trip ----


def test_a_new_trip_invites_people_you_know(client, trip, db):
    res = new_trip(
        client,
        [
            {"email": "jae@example.com", "role": "planner"},
            {"email": "ana@example.com", "role": "reader", "traveling": False},
        ],
    )
    assert res.status_code == 201, res.text
    created = res.json()
    # Mei and Jae are going; Ana is invited to help plan only. (The new
    # trip names its owner from the sign-in, hence "mei".)
    assert created["traveler_count"] == 2
    roster = client.get(f"/api/trips/{created['id']}/travelers", headers=MEI).json()
    assert [(t["name"], t["invited"]) for t in roster] == [("mei", False), ("Jae", True)]

    # Neither is a member until they say yes.
    members = client.get(f"/api/trips/{created['id']}/contributors", headers=MEI).json()
    assert [m["email"] for m in members] == ["mei@example.com"]

    # The invites aren't role links, so Trip settings doesn't list them.
    assert client.get(f"/api/trips/{created['id']}/invites", headers=MEI).json() == []

    [waiting] = invites_for(client, JAE)
    assert waiting["trip_name"] == "Japan"
    assert waiting["role"] == "planner"
    assert waiting["traveling"] is True
    assert waiting["invited_by"]["email"] == "mei@example.com"
    assert invites_for(client, ANA)[0]["traveling"] is False


def test_only_people_you_know_can_be_invited(client, trip, db):
    res = new_trip(client, [{"email": "zoe@example.com"}])
    assert res.status_code == 400
    assert "planned a trip with" in res.json()["detail"]
    # Nothing half-made is left behind.
    assert db.query(Trip).filter(Trip.name == "Japan").count() == 0


def test_repeats_and_yourself_are_ignored(client, trip):
    res = new_trip(
        client,
        [{"email": "jae@example.com"}, {"email": "jae@example.com"}, {"email": "mei@example.com"}],
    )
    assert res.status_code == 201, res.text
    assert len(invites_for(client, JAE)) == 1
    assert res.json()["traveler_count"] == 2


def test_a_trip_with_no_invitees_is_made_as_before(client, trip):
    res = new_trip(client)
    assert res.status_code == 201, res.text
    assert res.json()["traveler_count"] == 1


# ---- answering ----


def test_accepting_joins_with_the_role_and_claims_the_traveler(client, trip, db):
    trip_id = new_trip(client, [{"email": "jae@example.com", "role": "companion"}]).json()["id"]
    [waiting] = invites_for(client, JAE)

    res = client.post(f"/api/invites/{waiting['token']}/accept", json={}, headers=JAE)
    assert res.status_code == 200, res.text
    assert res.json()["my_role"] == "companion"
    # They became the traveler listed for them, not a second one.
    assert res.json()["traveler_count"] == 2
    jae = db.query(Traveler).filter(Traveler.trip_id == trip_id, Traveler.name == "Jae").one()
    assert jae.contributor_id == res.json()["my_contributor_id"]

    assert invites_for(client, JAE) == []
    # Single use.
    again = client.post(f"/api/invites/{waiting['token']}/accept", json={}, headers=JAE)
    assert again.status_code == 404


def test_accepting_a_planning_only_invite_adds_no_traveler(client, trip):
    new_trip(client, [{"email": "ana@example.com", "traveling": False}])
    [waiting] = invites_for(client, ANA)
    res = client.post(f"/api/invites/{waiting['token']}/accept", json={}, headers=ANA)
    assert res.status_code == 200, res.text
    assert res.json()["my_traveler_id"] is None
    assert res.json()["traveler_count"] == 1


def test_only_the_invitee_can_use_their_invite(client, trip):
    new_trip(client, [{"email": "jae@example.com"}])
    [waiting] = invites_for(client, JAE)
    token = waiting["token"]
    assert client.get(f"/api/invites/{token}", headers=ANA).status_code == 404
    assert client.post(f"/api/invites/{token}/accept", json={}, headers=ANA).status_code == 404
    assert client.post(f"/api/invites/{token}/decline", headers=ANA).status_code == 404
    assert client.get(f"/api/invites/{token}", headers=JAE).status_code == 200


def test_declining_takes_their_traveler_off_the_roster(client, trip):
    trip_id = new_trip(client, [{"email": "jae@example.com"}]).json()["id"]
    [waiting] = invites_for(client, JAE)
    res = client.post(f"/api/invites/{waiting['token']}/decline", headers=JAE)
    assert res.status_code == 204, res.text
    roster = client.get(f"/api/trips/{trip_id}/travelers", headers=MEI).json()
    assert [t["name"] for t in roster] == ["mei"]
    assert invites_for(client, JAE) == []
    assert client.post(f"/api/invites/{waiting['token']}/accept", json={}, headers=JAE).status_code == 404


def test_a_role_link_cant_be_declined(client, trip):
    link = client.post(f"/api/trips/{trip.id}/invites", json={"role": "reader"}, headers=MEI).json()
    assert client.post(f"/api/invites/{link['token']}/decline", headers=STRANGER).status_code == 404


def test_a_link_for_an_invited_traveler_is_its_own(client, trip, db):
    """The owner can still make a link for a traveler who has a direct
    invite waiting; it mustn't hand out the direct invite's token."""
    trip_id = new_trip(client, [{"email": "jae@example.com"}]).json()["id"]
    traveler = db.query(Traveler).filter(Traveler.trip_id == trip_id, Traveler.name == "Jae").one()
    link = client.post(f"/api/travelers/{traveler.id}/invite", json={"role": "planner"}, headers=MEI).json()
    assert link["token"] != invites_for(client, JAE)[0]["token"]


def test_deleting_your_account_declines_waiting_invites(client, trip, db):
    trip_id = new_trip(client, [{"email": "jae@example.com"}]).json()["id"]
    assert client.delete("/api/me", headers=JAE).status_code == 204
    roster = client.get(f"/api/trips/{trip_id}/travelers", headers=MEI).json()
    assert [t["name"] for t in roster] == ["mei"]
    assert db.query(TripInvite).filter(TripInvite.invitee_email == "jae@example.com").count() == 0
