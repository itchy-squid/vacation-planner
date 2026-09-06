from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Principal, get_current_principal
from ..db import get_db
from ..events import bus
from ..models import AvailabilityOverride, AvailabilityRule, Contributor, Pin
from ..schemas import (
    AvailabilityOverrideToggle,
    AvailabilityRuleIn,
    PinCreate,
    PinOut,
    PinUpdate,
)

router = APIRouter(tags=["pins"])


def _contributor_for(trip_id: str, principal: Principal, db: Session) -> Contributor | None:
    return db.scalar(select(Contributor).where(Contributor.trip_id == trip_id, Contributor.email == principal.email))


@router.get("/api/trips/{trip_id}/pins", response_model=list[PinOut])
def list_pins(trip_id: str, db: Session = Depends(get_db)):
    return db.scalars(select(Pin).where(Pin.trip_id == trip_id)).all()


@router.post("/api/trips/{trip_id}/pins", response_model=PinOut, status_code=201)
def create_pin(
    trip_id: str,
    payload: PinCreate,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    contributor = _contributor_for(trip_id, principal, db)
    pin = Pin(trip_id=trip_id, added_by_id=contributor.id if contributor else None, **payload.model_dump())
    db.add(pin)
    db.commit()
    db.refresh(pin)
    bus.publish(trip_id, "pin.created", {"pin_id": pin.id})
    return pin


@router.get("/api/pins/{pin_id}", response_model=PinOut)
def get_pin(pin_id: str, db: Session = Depends(get_db)):
    pin = db.get(Pin, pin_id)
    if not pin:
        raise HTTPException(status_code=404, detail="Pin not found")
    return pin


@router.patch("/api/pins/{pin_id}", response_model=PinOut)
def update_pin(pin_id: str, payload: PinUpdate, db: Session = Depends(get_db)):
    """Edits are immediate — no local draft, matching the handoff README's
    "Editing" behaviour. Every change is visible to the whole group via the
    trip's SSE stream."""
    pin = db.get(Pin, pin_id)
    if not pin:
        raise HTTPException(status_code=404, detail="Pin not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(pin, field, value)
    db.commit()
    db.refresh(pin)
    bus.publish(pin.trip_id, "pin.updated", {"pin_id": pin.id})
    return pin


@router.put("/api/pins/{pin_id}/availability-rule")
def set_availability_rule(pin_id: str, payload: AvailabilityRuleIn, db: Session = Depends(get_db)):
    pin = db.get(Pin, pin_id)
    if not pin:
        raise HTTPException(status_code=404, detail="Pin not found")
    rule = pin.availability_rule
    if not rule:
        rule = AvailabilityRule(pin_id=pin_id)
        db.add(rule)
    rule.days = payload.days
    rule.bands = payload.bands
    rule.reasons = payload.reasons
    db.commit()
    return {"status": "ok"}


@router.post("/api/pins/{pin_id}/availability-overrides/toggle")
def toggle_availability_override(
    pin_id: str,
    payload: AvailabilityOverrideToggle,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    """A tap flips one cell in the availability grid — see handoff README
    "Interactions & behaviour → Availability overrides"."""
    pin = db.get(Pin, pin_id)
    if not pin:
        raise HTTPException(status_code=404, detail="Pin not found")

    existing = db.scalar(
        select(AvailabilityOverride).where(
            AvailabilityOverride.pin_id == pin_id,
            AvailabilityOverride.day == payload.day,
            AvailabilityOverride.band == payload.band,
        )
    )
    contributor = _contributor_for(pin.trip_id, principal, db)
    if existing:
        db.delete(existing)
        db.commit()
        bus.publish(pin.trip_id, "availability.overridden", {"pin_id": pin_id, "active": False})
        return {"overridden": False}

    override = AvailabilityOverride(
        pin_id=pin_id,
        day=payload.day,
        band=payload.band,
        created_by_id=contributor.id if contributor else None,
    )
    db.add(override)
    db.commit()
    bus.publish(pin.trip_id, "availability.overridden", {"pin_id": pin_id, "active": True})
    return {"overridden": True}
