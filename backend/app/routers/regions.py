"""Where the trip's regions are on the map (app/models.py TripRegion).

A pin with no exact spot shows in its region on the Map tab. The frontend
finds a region on Google the first time the trip uses it and stores it
here, so every later view (and everyone else on the trip) reads it back
instead of looking it up again.

- Anyone who can see the ideas can see the regions.
- Anyone who can add ideas can set where a region is. Setting a name the
  trip already has, in any case, moves it.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..events import bus
from ..models import TripRegion
from ..permissions import IDEAS_ADD, IDEAS_READ, Access, require
from ..schemas import TripRegionIn, TripRegionOut

router = APIRouter(prefix="/api", tags=["regions"])


def region_key(name: str) -> str:
    return name.strip().lower()


@router.get("/trips/{trip_id}/regions", response_model=list[TripRegionOut])
def list_regions(trip_id: int, _: Access = Depends(require(IDEAS_READ)), db: Session = Depends(get_db)):
    return db.scalars(select(TripRegion).where(TripRegion.trip_id == trip_id).order_by(TripRegion.name)).all()


@router.put("/trips/{trip_id}/regions", response_model=TripRegionOut)
def set_region(
    trip_id: int,
    payload: TripRegionIn,
    _: Access = Depends(require(IDEAS_ADD)),
    db: Session = Depends(get_db),
):
    name = payload.name.strip()
    key = region_key(name)
    region = db.scalar(select(TripRegion).where(TripRegion.trip_id == trip_id, TripRegion.name_key == key))
    if region is None:
        region = TripRegion(trip_id=trip_id, name_key=key)
        db.add(region)
    region.name = name
    for field in ("lat", "lng", "south", "west", "north", "east"):
        setattr(region, field, getattr(payload, field))
    db.commit()
    db.refresh(region)
    bus.publish(trip_id, "region.updated", {"region_id": region.id})
    return region
