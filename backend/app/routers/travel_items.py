from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..events import bus
from ..models import PlanItem, TravelItem
from ..permissions import IDEAS_ADD, IDEAS_READ, Access, require
from ..scheduling_conflicts import scheduled_conflict_detail
from ..schemas import TravelItemCreate, TravelItemOut, TravelItemUpdate
from .pins import ensure_may_set_costs

router = APIRouter(prefix="/api", tags=["travel-items"])


@router.get("/trips/{trip_id}/travel-items", response_model=list[TravelItemOut])
def list_travel_items(trip_id: int, _: Access = Depends(require(IDEAS_READ)), db: Session = Depends(get_db)):
    return db.scalars(select(TravelItem).where(TravelItem.trip_id == trip_id)).all()


@router.post("/trips/{trip_id}/travel-items", response_model=TravelItemOut, status_code=201)
def create_travel_item(
    trip_id: int,
    payload: TravelItemCreate,
    access: Access = Depends(require(IDEAS_ADD)),
    db: Session = Depends(get_db),
):
    ensure_may_set_costs(access, payload.model_dump(exclude_defaults=True), access.member.id)
    item = TravelItem(trip_id=trip_id, added_by_id=access.member.id, **payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    bus.publish(trip_id, "travel_item.created", {"travel_item_id": item.id})
    return item


@router.patch("/travel-items/{travel_item_id}", response_model=TravelItemOut)
def update_travel_item(
    travel_item_id: int,
    payload: TravelItemUpdate,
    access: Access = Depends(require(IDEAS_ADD)),
    db: Session = Depends(get_db),
):
    item = db.get(TravelItem, travel_item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Travel item not found")
    access.ensure_may_edit_idea(item.added_by_id)
    fields = payload.model_dump(exclude_unset=True)
    ensure_may_set_costs(access, fields, item.added_by_id)
    for field, value in fields.items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    bus.publish(item.trip_id, "travel_item.updated", {"travel_item_id": item.id})
    return item


@router.delete("/travel-items/{travel_item_id}", status_code=204)
def delete_travel_item(travel_item_id: int, access: Access = Depends(require(IDEAS_ADD)), db: Session = Depends(get_db)):
    item = db.get(TravelItem, travel_item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Travel item not found")
    access.ensure_may_edit_idea(item.added_by_id)
    referenced = db.scalar(select(PlanItem).where(PlanItem.travel_item_id == travel_item_id))
    if referenced is not None:
        raise HTTPException(status_code=409, detail=scheduled_conflict_detail(db, referenced, "travel item"))

    trip_id = item.trip_id
    db.delete(item)
    db.commit()
    bus.publish(trip_id, "travel_item.removed", {"travel_item_id": travel_item_id})
    return None
