"""The people you've planned trips with — the app's People tab, and who a
new trip can invite directly ("Who's planning with you?" on the new-trip
form, routers/trips.py create_trip).

There is no user table and no friend list to keep: a person is the
Contributor rows they have, matched by email, so "people you know" is
everyone who is a member of a trip you're a member of. Nobody has to ask
or accept anything to be on it, and it changes as trips do: leave every
trip you shared with someone and they drop off.

Waiting invites, and accepting or declining one, are in routers/sharing.py
with the rest of how people get on a trip.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Principal, get_current_principal
from ..db import get_db
from ..models import Contributor, Trip
from ..schemas import PersonOut, PersonTripOut

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
