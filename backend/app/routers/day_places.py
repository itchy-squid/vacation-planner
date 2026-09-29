"""Where the group is on each day of the trip ("Where we'll be";
app/models.py TripDayPlace).

- Anyone who can see the plan can see the places.
- Anyone who can put things on the calendar (owner, planner) can set them.
  A PUT replaces whole days, which is what setting several days at once,
  clearing them, and undoing either one all need.
- Only dates inside the trip can be set; a trip without dates has none.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..events import bus
from ..models import Pin, Trip, TripDayPlace
from ..permissions import PLANS_READ, PLANS_WRITE, Access, require
from ..schemas import DayPlaces, DayPlacesUpdate
from .regions import region_key

router = APIRouter(prefix="/api", tags=["day places"])

STAY = "stay"
VISIT = "visit"


def _days_of(db: Session, trip_id: int) -> list[DayPlaces]:
    rows = db.scalars(
        select(TripDayPlace)
        .where(TripDayPlace.trip_id == trip_id)
        .order_by(TripDayPlace.date, TripDayPlace.position)
    ).all()
    by_date: dict[date, DayPlaces] = {}
    for row in rows:
        day = by_date.setdefault(row.date, DayPlaces(date=row.date))
        if row.kind == STAY:
            day.stay = row.name
            day.lodging_pin_id = row.pin_id
        else:
            day.visits.append(row.name)
    return list(by_date.values())


def _trip_dates(trip: Trip) -> tuple[date, date]:
    if trip.start_date is None:
        raise HTTPException(status_code=422, detail="Set the trip's dates before saying where you'll be each day")
    return trip.start_date, trip.end_date or trip.start_date


@router.get("/trips/{trip_id}/day-places", response_model=list[DayPlaces])
def list_day_places(trip_id: int, _: Access = Depends(require(PLANS_READ)), db: Session = Depends(get_db)):
    return _days_of(db, trip_id)


@router.put("/trips/{trip_id}/day-places", response_model=list[DayPlaces])
def set_day_places(
    trip_id: int,
    payload: DayPlacesUpdate,
    _: Access = Depends(require(PLANS_WRITE)),
    db: Session = Depends(get_db),
):
    first, last = _trip_dates(db.get(Trip, trip_id))
    outside = [day.date for day in payload.days if not first <= day.date <= last]
    if outside:
        raise HTTPException(
            status_code=422,
            detail=f"{outside[0].isoformat()} isn't one of the trip's days ({first.isoformat()} to {last.isoformat()})",
        )

    for day in payload.days:
        if day.lodging_pin_id is not None:
            _ensure_lodging(db, trip_id, day.lodging_pin_id)

    dates = [day.date for day in payload.days]
    db.execute(delete(TripDayPlace).where(TripDayPlace.trip_id == trip_id, TripDayPlace.date.in_(dates)))
    for day in payload.days:
        if day.stay is not None:
            stay = _row(trip_id, day.date, day.stay, STAY, 0)
            stay.pin_id = day.lodging_pin_id
            db.add(stay)
        for position, name in enumerate(day.visits, start=1):
            db.add(_row(trip_id, day.date, name, VISIT, position))
    db.commit()
    bus.publish(trip_id, "day_places.updated", {"dates": [d.isoformat() for d in dates]})
    return _days_of(db, trip_id)


def _row(trip_id: int, on: date, name: str, kind: str, position: int) -> TripDayPlace:
    return TripDayPlace(trip_id=trip_id, date=on, name=name, name_key=region_key(name), kind=kind, position=position)


def _ensure_lodging(db: Session, trip_id: int, pin_id: int) -> None:
    """The place a day is staying at has to be one of this trip's ideas,
    and one with an exact spot: a trip from the map starts and ends there,
    and a route needs somewhere to start from. An idea on another trip is
    refused the same way as one that doesn't exist."""
    pin = db.get(Pin, pin_id)
    if pin is None or pin.trip_id != trip_id:
        raise HTTPException(status_code=422, detail="That place isn't one of this trip's ideas")
    if pin.lat is None or pin.lng is None:
        raise HTTPException(status_code=422, detail=f"Pin {pin.title} on the map before staying there")
