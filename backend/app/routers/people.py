"""The people you've planned trips with — the app's People tab, and who a
new trip can invite directly ("Who's planning with you?" on the new-trip
form, routers/trips.py create_trip).

There is no user table and no friend list to keep: a person is the
Contributor rows they have, matched by email, so "people you know" is
everyone who is a member of a trip you're a member of. Nobody has to ask
or accept anything to be on it, and it changes as trips do: leave every
trip you shared with someone and they drop off.

Past travelers (GET /people/travelers) are the people who went on those
trips without an account, like a child or a grandparent: a new trip can
list them again without typing them in.

Waiting invites, and accepting or declining one, are in routers/sharing.py
with the rest of how people get on a trip.
"""

from __future__ import annotations

import re
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Principal, get_current_principal
from ..db import get_db
from ..models import Contributor, Traveler, Trip, TripInvite
from ..schemas import PastTravelerOut, PastTravelerTripOut, PersonOut, PersonTripOut

router = APIRouter(prefix="/api", tags=["people"])


def _when(trip: Trip) -> tuple[date, int]:
    """How recent a trip is: when it starts, or when it was made if it has
    no dates yet."""
    return (trip.start_date or trip.created_at.date(), trip.id)


def people_for(db: Session, email: str) -> list[PersonOut]:
    """Everyone who shares a trip with `email`, most recently shared first.
    Their name, tint and suggested role come from the latest of those
    trips."""
    my_trips = select(Contributor.trip_id).where(Contributor.email == email)
    rows = db.execute(
        select(Contributor, Trip)
        .join(Trip, Trip.id == Contributor.trip_id)
        .where(Contributor.trip_id.in_(my_trips), Contributor.email != email)
    ).all()

    by_email: dict[str, list[tuple[Contributor, Trip]]] = {}
    for member, trip in rows:
        by_email.setdefault(member.email, []).append((member, trip))

    people: list[tuple[tuple[date, int], PersonOut]] = []
    for person_email, shared in by_email.items():
        shared.sort(key=lambda pair: _when(pair[1]), reverse=True)
        latest, latest_trip = shared[0]
        people.append(
            (
                _when(latest_trip),
                PersonOut(
                    email=person_email,
                    display_name=latest.display_name,
                    initial=latest.initial,
                    tint=latest.tint,
                    last_role=latest.role,
                    trips=[
                        PersonTripOut(
                            id=trip.id,
                            name=trip.name,
                            start_date=trip.start_date,
                            end_date=trip.end_date,
                            role=member.role,
                        )
                        for member, trip in shared
                    ],
                ),
            )
        )
    # Most recent first; a name breaks ties so the order is stable.
    people.sort(key=lambda entry: entry[1].display_name.lower())
    people.sort(key=lambda entry: entry[0], reverse=True)
    return [person for _, person in people]


@router.get("/people", response_model=list[PersonOut])
def list_people(principal: Principal = Depends(get_current_principal), db: Session = Depends(get_db)):
    return people_for(db, principal.email)


# "Traveler 5": a stand-in the headcount migration added (migration
# a91d4c7e2f58), not anyone to bring on another trip.
_PLACEHOLDER = re.compile(r"traveler \d+", re.IGNORECASE)


def past_travelers_for(db: Session, email: str) -> list[PastTravelerOut]:
    """Everyone listed without an account on a trip `email` is a member
    of, most recent first. There is no record of them beyond each trip's
    roster, so the same person on two trips is matched by name (ignoring
    case) and by the email of whoever paid for them: Mei's Kai on two
    trips is one entry, while a Kai someone else paid for is another.
    Placeholders, and travelers an invite is waiting to hand to someone
    with an account, are left out."""
    my_trips = select(Contributor.trip_id).where(Contributor.email == email)
    invited = select(TripInvite.traveler_id).where(
        TripInvite.traveler_id.is_not(None),
        TripInvite.invitee_email.is_not(None),
        TripInvite.revoked_at.is_(None),
    )
    rows = db.execute(
        select(Traveler, Trip)
        .join(Trip, Trip.id == Traveler.trip_id)
        .where(
            Traveler.trip_id.in_(my_trips),
            Traveler.contributor_id.is_(None),
            Traveler.id.not_in(invited),
        )
    ).all()

    payer_ids = {t.paid_by_id for t, _ in rows if t.paid_by_id is not None}
    payers: dict[int, Contributor] = {}
    if payer_ids:
        for traveler_id, member in db.execute(
            select(Traveler.id, Contributor)
            .join(Contributor, Contributor.id == Traveler.contributor_id)
            .where(Traveler.id.in_(payer_ids))
        ).all():
            payers[traveler_id] = member

    by_key: dict[tuple[str, str | None], list[tuple[Traveler, Trip, Contributor | None]]] = {}
    for traveler, trip in rows:
        name = traveler.name.strip()
        if not name or _PLACEHOLDER.fullmatch(name):
            continue
        payer = payers.get(traveler.paid_by_id) if traveler.paid_by_id is not None else None
        key = (name.lower(), payer.email if payer else None)
        by_key.setdefault(key, []).append((traveler, trip, payer))

    out: list[tuple[tuple[date, int], PastTravelerOut]] = []
    for (name_key, payer_email), seen in by_key.items():
        seen.sort(key=lambda entry: _when(entry[1]), reverse=True)
        latest, latest_trip, payer = seen[0]
        trips: list[PastTravelerTripOut] = []
        for _, trip, _ in seen:
            if all(t.id != trip.id for t in trips):
                trips.append(PastTravelerTripOut(id=trip.id, name=trip.name, start_date=trip.start_date))
        out.append(
            (
                _when(latest_trip),
                PastTravelerOut(
                    key=f"{name_key}|{payer_email or ''}",
                    name=latest.name.strip(),
                    initial=latest.initial,
                    tint=latest.tint,
                    paid_by_email=payer_email,
                    paid_by_name=payer.display_name if payer else None,
                    paid_by_you=payer_email == email,
                    trips=trips,
                ),
            )
        )
    out.sort(key=lambda entry: entry[1].name.lower())
    out.sort(key=lambda entry: entry[0], reverse=True)
    return [traveler for _, traveler in out]


@router.get("/people/travelers", response_model=list[PastTravelerOut])
def list_past_travelers(principal: Principal = Depends(get_current_principal), db: Session = Depends(get_db)):
    return past_travelers_for(db, principal.email)
