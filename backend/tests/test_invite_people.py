"""Inviting people you've planned with to a trip that already exists, and
listing past travelers without an account on a new trip.

See routers/sharing.py (send_direct_invites), routers/people.py
(past_travelers_for) and routers/trips.py create_trip (`listed`). The
fixture trip is Mei's Taiwan, with Jae, Ana and Lin on it.
"""

from datetime import date

from app.models import Contributor, Traveler, Trip, TripInvite

from conftest import as_user

MEI = as_user("mei@example.com")
JAE = as_user("jae@example.com")
ANA = as_user("ana@example.com")
LIN = as_user("lin@example.com")


def make_trip(db, name="Kyoto", start=date(2027, 4, 3), members=("mei",), listed=()):
    """A trip of Mei's with `members` on the app and `listed` travelers
    (name, payer key or None) without an account."""
    trip = Trip(name=name, start_date=start)
    db.add(trip)
    db.flush()
    travelers = {}
    for position, key in enumerate(members):
        member = Contributor(
            trip_id=trip.id, email=f"{key}@example.com", display_name=key.title(), initial=key[0].upper(),
            role="owner" if key == "mei" else "planner",
        )
        db.add(member)
        db.flush()
        travelers[key] = Traveler(trip_id=trip.id, name=member.display_name, initial=member.initial, contributor_id=member.id, position=position)
        db.add(travelers[key])
    db.flush()
    for offset, (name_, payer) in enumerate(listed):
        traveler = Traveler(
            trip_id=trip.id, name=name_, initial=name_[0], position=len(members) + offset,
            paid_by_id=travelers[payer].id if payer else None,
        )
        db.add(traveler)
        travelers[name_] = traveler
    db.commit()
    return trip, travelers


def invite(client, trip_id, invitees, headers=MEI):
    return client.post(f"/api/trips/{trip_id}/direct-invites", json={"invitees": invitees}, headers=headers)


def waiting_for(client, headers):
    return client.get("/api/me/invites", headers=headers).json()


def roster(client, trip_id):
    return client.get(f"/api/trips/{trip_id}/travelers", headers=MEI).json()


# ---- inviting to an existing trip ----


def test_invite_someone_as_a_new_traveler(client, trip, db):
    kyoto, _ = make_trip(db)
    res = invite(client, kyoto.id, [{"email": "jae@example.com", "role": "companion"}])
    assert res.status_code == 201, res.text
    [sent] = res.json()
    assert sent["email"] == "jae@example.com"
    assert [(t["name"], t["invited"]) for t in roster(client, kyoto.id)] == [("Mei", False), ("Jae", True)]
    [waiting] = waiting_for(client, JAE)
    assert waiting["trip_name"] == "Kyoto"
    assert waiting["role"] == "companion"
    listed = client.get(f"/api/trips/{kyoto.id}/direct-invites", headers=MEI).json()
    assert [i["email"] for i in listed] == ["jae@example.com"]


def test_swap_in_for_a_listed_traveler(client, trip, db):
    kyoto, travelers = make_trip(db, listed=[("Traveler 5", "mei")])
    spot = travelers["Traveler 5"].id
    res = invite(client, kyoto.id, [{"email": "jae@example.com", "role": "planner", "traveler_id": spot}])
    assert res.status_code == 201, res.text
    # No second traveler: the invite waits on the one that's listed.
    assert [(t["name"], t["invited"]) for t in roster(client, kyoto.id)] == [("Mei", False), ("Traveler 5", True)]

    [waiting] = waiting_for(client, JAE)
    assert waiting["traveling"] is True
    res = client.post(f"/api/invites/{waiting['token']}/accept", json={}, headers=JAE)
    assert res.status_code == 200, res.text
    assert res.json()["my_traveler_id"] == spot
    db.expire_all()
    claimed = db.get(Traveler, spot)
    # The spot takes their name (from the sign-in, hence "jae"), and
    # keeps who pays for it.
    assert claimed.name == "jae"
    assert claimed.paid_by_id == travelers["mei"].id
    assert claimed.contributor_id == res.json()["my_contributor_id"]


def test_declining_a_swap_leaves_the_listed_traveler(client, trip, db):
    kyoto, travelers = make_trip(db, listed=[("Jae", None)])
    invite(client, kyoto.id, [{"email": "jae@example.com", "traveler_id": travelers["Jae"].id}])
    [waiting] = waiting_for(client, JAE)
    assert client.post(f"/api/invites/{waiting['token']}/decline", headers=JAE).status_code == 204
    assert [(t["name"], t["invited"]) for t in roster(client, kyoto.id)] == [("Mei", False), ("Jae", False)]


def test_declining_as_a_new_traveler_still_removes_them(client, trip, db):
    kyoto, _ = make_trip(db)
    invite(client, kyoto.id, [{"email": "jae@example.com"}])
    [waiting] = waiting_for(client, JAE)
    assert client.post(f"/api/invites/{waiting['token']}/decline", headers=JAE).status_code == 204
    assert [t["name"] for t in roster(client, kyoto.id)] == ["Mei"]


def test_a_planning_only_invite_lists_nobody(client, trip, db):
    kyoto, _ = make_trip(db)
    res = invite(client, kyoto.id, [{"email": "ana@example.com", "role": "reader", "traveling": False}])
    assert res.status_code == 201, res.text
    assert [t["name"] for t in roster(client, kyoto.id)] == ["Mei"]
    assert waiting_for(client, ANA)[0]["traveling"] is False


def test_only_people_you_know_and_nobody_already_there(client, trip, db):
    kyoto, travelers = make_trip(db, members=("mei", "ana"))
    stranger = invite(client, kyoto.id, [{"email": "zoe@example.com"}])
    assert stranger.status_code == 400
    already = invite(client, kyoto.id, [{"email": "ana@example.com"}])
    assert already.status_code == 409
    assert "already on Kyoto" in already.json()["detail"]
    # Neither left anything behind.
    assert db.query(TripInvite).filter(TripInvite.trip_id == kyoto.id).count() == 0


def test_one_waiting_invite_per_person_and_per_spot(client, trip, db):
    kyoto, travelers = make_trip(db, listed=[("Traveler 5", None)])
    spot = travelers["Traveler 5"].id
    assert invite(client, kyoto.id, [{"email": "jae@example.com", "traveler_id": spot}]).status_code == 201
    again = invite(client, kyoto.id, [{"email": "jae@example.com"}])
    assert again.status_code == 409
    taken = invite(client, kyoto.id, [{"email": "lin@example.com", "traveler_id": spot}])
    assert taken.status_code == 409
    both = invite(
        client, kyoto.id,
        [{"email": "ana@example.com", "traveler_id": spot}, {"email": "lin@example.com"}],
    )
    assert both.status_code == 409
    assert waiting_for(client, LIN) == []


def test_cant_swap_in_for_someone_on_the_app(client, trip, db):
    kyoto, travelers = make_trip(db)
    res = invite(client, kyoto.id, [{"email": "jae@example.com", "traveler_id": travelers["mei"].id}])
    assert res.status_code == 409


def test_a_spot_kept_for_an_invitee_isnt_offered_on_a_link(client, trip, db):
    kyoto, travelers = make_trip(db, listed=[("Traveler 5", None), ("Kai", None)])
    spot = travelers["Traveler 5"].id
    old_link = client.post(f"/api/travelers/{spot}/invite", json={"role": "companion"}, headers=MEI).json()
    invite(client, kyoto.id, [{"email": "jae@example.com", "traveler_id": spot}])

    # The link made for that spot stopped working...
    assert client.get(f"/api/invites/{old_link['token']}", headers=ANA).status_code == 404
    # ...and the general link no longer offers it, or lets anyone take it.
    link = client.post(f"/api/trips/{kyoto.id}/invites", json={"role": "reader"}, headers=MEI).json()
    preview = client.get(f"/api/invites/{link['token']}", headers=ANA).json()
    assert [t["name"] for t in preview["unclaimed_travelers"]] == ["Kai"]
    grab = client.post(f"/api/invites/{link['token']}/accept", json={"traveler_id": spot}, headers=ANA)
    assert grab.status_code == 409


def test_only_the_owner_sends_invites(client, trip, db):
    kyoto, _ = make_trip(db, members=("mei", "ana"))
    res = invite(client, kyoto.id, [{"email": "jae@example.com"}], headers=ANA)
    assert res.status_code == 403
    assert client.get(f"/api/trips/{kyoto.id}/direct-invites", headers=ANA).status_code == 403


# ---- past travelers without an account ----


def test_past_travelers_are_listed_with_who_paid(client, trip, db):
    make_trip(db, name="Peru", start=date(2026, 3, 1), listed=[("Kai", "mei"), ("Theo", None), ("Traveler 4", None)])
    make_trip(db, name="Chile", start=date(2026, 9, 1), listed=[("kai", "mei")])
    rows = client.get("/api/people/travelers", headers=MEI).json()
    kai = next(r for r in rows if r["name"].lower() == "kai")
    # The same Kai paid for by Mei on both trips is one entry, latest first.
    assert [t["name"] for t in kai["trips"]] == ["Chile", "Peru"]
    assert kai["paid_by_email"] == "mei@example.com"
    assert kai["paid_by_name"] == "Mei"
    assert kai["paid_by_you"] is True
    theo = next(r for r in rows if r["name"] == "Theo")
    assert theo["paid_by_email"] is None
    # Placeholders aren't anyone to bring along.
    assert all(r["name"] != "Traveler 4" for r in rows)
    assert len(rows) == 2


def test_past_travelers_are_only_from_your_trips(client, trip, db):
    peru, travelers = make_trip(db, name="Peru", listed=[("Kai", None)])
    assert client.get("/api/people/travelers", headers=JAE).json() == []
    db.add(Contributor(trip_id=peru.id, email="jae@example.com", display_name="Jae", initial="J", role="reader"))
    db.commit()
    assert [r["name"] for r in client.get("/api/people/travelers", headers=JAE).json()] == ["Kai"]


def test_a_spot_waiting_on_an_invitee_isnt_a_past_traveler(client, trip, db):
    kyoto, travelers = make_trip(db, listed=[("Traveler 5", None), ("Jo", None)])
    invite(client, kyoto.id, [{"email": "jae@example.com", "traveler_id": travelers["Jo"].id}])
    assert client.get("/api/people/travelers", headers=MEI).json() == []


def test_a_new_trip_lists_past_travelers_with_their_payer(client, trip, db):
    res = client.post(
        "/api/trips",
        json={
            "name": "Iceland",
            "invitees": [{"email": "jae@example.com"}, {"email": "ana@example.com", "traveling": False}],
            "listed": [
                {"name": "Kai", "paid_by_email": "jae@example.com"},
                {"name": "Grandma Hua", "paid_by_me": True},
                {"name": "Theo", "paid_by_email": "ana@example.com"},
                {"name": "Bo"},
            ],
        },
        headers=MEI,
    )
    assert res.status_code == 201, res.text
    assert res.json()["traveler_count"] == 6
    rows = roster(client, res.json()["id"])
    by_name = {t["name"]: t for t in rows}
    assert by_name["Kai"]["paid_by_id"] == by_name["Jae"]["id"]
    assert by_name["Grandma Hua"]["paid_by_id"] == by_name["mei"]["id"]
    # Ana isn't going, so can't pay; Theo pays their own way.
    assert by_name["Theo"]["paid_by_id"] is None
    assert by_name["Bo"]["paid_by_id"] is None
    assert not any(t["invited"] for t in rows if t["name"] in {"Kai", "Grandma Hua", "Theo", "Bo"})
    # Only Jae and Ana get invites.
    assert db.query(TripInvite).filter(TripInvite.trip_id == res.json()["id"]).count() == 2
