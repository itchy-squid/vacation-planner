from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Principal, get_current_principal
from ..db import get_db
from ..models import Contributor, Trip
from ..schemas import ContributorOut, TripCreate, TripOut, TripUpdate

router = APIRouter(prefix="/api/trips", tags=["trips"])


@router.get("", response_model=list[TripOut])
def list_trips(db: Session = Depends(get_db)):
    return db.scalars(select(Trip)).all()


@router.post("", response_model=TripOut, status_code=201)
def create_trip(
    payload: TripCreate,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    trip = Trip(
        name=payload.name,
        region_line=payload.region_line,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    db.add(trip)
    db.flush()

    # The creator becomes the trip's sole owner-contributor, same shape as
    # a seeded trip's owner (see app/seed.py). Without this a freshly
    # created trip would have zero contributors and nothing to attribute
    # future pins/votes/comments to.
    owner = Contributor(
        trip_id=trip.id,
        email=principal.email,
        display_name=principal.display_name,
        initial=(principal.display_name[:1] or "?").upper(),
        is_owner=True,
    )
    db.add(owner)
    db.commit()
    db.refresh(trip)
    return trip


@router.get("/{trip_id}", response_model=TripOut)
def get_trip(trip_id: int, db: Session = Depends(get_db)):
    trip = db.get(Trip, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    return trip


@router.patch("/{trip_id}", response_model=TripOut)
def update_trip(trip_id: int, payload: TripUpdate, db: Session = Depends(get_db)):
    """Trip settings (name, regions, dates) — see the frontend's
    pages/TripSettings.jsx. Same immediate-edit, exclude_unset pattern as
    update_pin in app/routers/pins.py."""
    trip = db.get(Trip, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(trip, field, value)
    db.commit()
    db.refresh(trip)
    return trip


@router.get("/{trip_id}/contributors", response_model=list[ContributorOut])
def list_contributors(trip_id: int, db: Session = Depends(get_db)):
    return db.scalars(select(Contributor).where(Contributor.trip_id == trip_id)).all()
