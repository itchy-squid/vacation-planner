from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Principal, get_current_principal
from ..db import get_db
from ..events import bus
from ..models import Contributor, PlanItem, TravelItem
from ..schemas import TravelItemCreate, TravelItemOut, TravelItemUpdate

router = APIRouter(prefix="/api", tags=["travel-items"])


def _contributor_for(trip_id: int, principal: Principal, db: Session) -> Contributor | None:
    return db.scalar(select(Contributor).where(Contributor.trip_id == trip_id, Contributor.email == principal.email))


@router.get("/trips/{trip_id}/travel-items", response_model=list[TravelItemOut])
def list_travel_items(trip_id: int, db: Session = Depends(get_db)):
    return db.scalars(select(TravelItem).where(TravelItem.trip_id == trip_id)).all()


@router.post("/trips/{trip_id}/travel-items", response_model=TravelItemOut, status_code=201)
def create_travel_item(
    trip_id: int,
    payload: TravelItemCreate,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    contributor = _contributor_for(trip_id, principal, db)
    item = TravelItem(trip_id=trip_id, added_by_id=contributor.id if contributor else None, **payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    bus.publish(trip_id, "travel_item.created", {"travel_item_id": item.id})
    return item


@router.patch("/travel-items/{travel_item_id}", response_model=TravelItemOut)
def update_travel_item(travel_item_id: int, payload: TravelItemUpdate, db: Session = Depends(get_db)):
    item = db.get(TravelItem, travel_item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Travel item not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    bus.publish(item.trip_id, "travel_item.updated", {"travel_item_id": item.id})
    return item


@router.delete("/travel-items/{travel_item_id}", status_code=204)
def delete_travel_item(travel_item_id: int, db: Session = Depends(get_db)):
    item = db.get(TravelItem, travel_item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Travel item not found")
    referenced = db.scalar(select(PlanItem).where(PlanItem.travel_item_id == travel_item_id))
    if referenced is not None:
        raise HTTPException(status_code=409, detail="This travel item is scheduled in a plan — unplace it first")

    trip_id = item.trip_id
    db.delete(item)
    db.commit()
    bus.publish(trip_id, "travel_item.removed", {"travel_item_id": travel_item_id})
    return None
