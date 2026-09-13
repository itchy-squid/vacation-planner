import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import photo_storage
from ..auth import Principal, get_current_principal
from ..db import SessionLocal, get_db
from ..events import bus
from ..models import AvailabilityOverride, AvailabilityRule, Contributor, Pin, PlanItem
from ..schemas import (
    AvailabilityOverrideToggle,
    AvailabilityRuleIn,
    PinCreate,
    PinOut,
    PinUpdate,
)

router = APIRouter(tags=["pins"])
logger = logging.getLogger(__name__)


def _contributor_for(trip_id: int, principal: Principal, db: Session) -> Contributor | None:
    return db.scalar(select(Contributor).where(Contributor.trip_id == trip_id, Contributor.email == principal.email))


def _mirror_pin_photo(pin_id: int, trip_id: int, source_url: str) -> None:
    """Runs after the response for create_pin/update_pin has already gone
    out (see BackgroundTasks below) — a slow or large source image never
    delays "Add to board". Opens its own DB session because the
    request's session (from get_db) is already closed by the time a
    background task runs.

    Re-checks the pin's photo_url before writing back, in case it moved
    on while the copy was in flight — someone re-edited the pin, or
    picked "No image" — so a slow mirror can never resurrect a photo the
    pin no longer has."""
    mirrored_url = photo_storage.mirror_photo_to_blob(source_url, trip_id=trip_id, pin_id=pin_id)
    if not mirrored_url:
        return
    db = SessionLocal()
    try:
        pin = db.get(Pin, pin_id)
        if pin is None or pin.photo_url != source_url:
            return
        pin.photo_url = mirrored_url
        db.commit()
        bus.publish(trip_id, "pin.updated", {"pin_id": pin_id})
    except Exception:
        logger.exception("Couldn't save the mirrored photo for pin %s", pin_id)
    finally:
        db.close()


@router.get("/api/trips/{trip_id}/pins", response_model=list[PinOut])
def list_pins(trip_id: int, db: Session = Depends(get_db)):
    return db.scalars(select(Pin).where(Pin.trip_id == trip_id)).all()


@router.post("/api/trips/{trip_id}/pins", response_model=PinOut, status_code=201)
def create_pin(
    trip_id: int,
    payload: PinCreate,
    background_tasks: BackgroundTasks,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    contributor = _contributor_for(trip_id, principal, db)
    pin = Pin(trip_id=trip_id, added_by_id=contributor.id if contributor else None, **payload.model_dump())
    db.add(pin)
    db.commit()
    db.refresh(pin)
    bus.publish(trip_id, "pin.created", {"pin_id": pin.id})
    # Chosen from the link-preview picker (pages/NewPin.jsx) — still just
    # hotlinked at this point (that's what's in pin.photo_url right now,
    # and what this response returns). Copying it into our own storage is
    # not this request's problem to wait on — see _mirror_pin_photo.
    if pin.photo_url:
        background_tasks.add_task(_mirror_pin_photo, pin.id, trip_id, pin.photo_url)
    return pin


@router.get("/api/pins/{pin_id}", response_model=PinOut)
def get_pin(pin_id: int, db: Session = Depends(get_db)):
    pin = db.get(Pin, pin_id)
    if not pin:
        raise HTTPException(status_code=404, detail="Pin not found")
    return pin


@router.patch("/api/pins/{pin_id}", response_model=PinOut)
def update_pin(pin_id: int, payload: PinUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Edits are immediate — no local draft, matching the handoff README's
    "Editing" behaviour. Every change is visible to the whole group via the
    trip's SSE stream."""
    pin = db.get(Pin, pin_id)
    if not pin:
        raise HTTPException(status_code=404, detail="Pin not found")
    fields = payload.model_dump(exclude_unset=True)
    for field, value in fields.items():
        setattr(pin, field, value)
    db.commit()
    db.refresh(pin)
    bus.publish(pin.trip_id, "pin.updated", {"pin_id": pin.id})
    # Only when this request is the one that actually set photo_url to a
    # new external link — not on every edit, and not when photo_url is
    # already one of our own mirrored blobs (photo_storage.mirror_photo_
    # to_blob would just skip it, but there's no reason to schedule the
    # task at all in that case).
    if "photo_url" in fields and pin.photo_url and not photo_storage.is_our_blob_url(pin.photo_url):
        background_tasks.add_task(_mirror_pin_photo, pin.id, pin.trip_id, pin.photo_url)
    return pin


@router.delete("/api/pins/{pin_id}", status_code=204)
def delete_pin(pin_id: int, db: Session = Depends(get_db)):
    """Permanently deletes the pin itself — distinct from unplacing it
    (DELETE /api/plans/{plan_id}, which only removes its Plan/PlanItem and
    leaves the pin in the unscheduled tray). Rejected the same way
    routers/travel_items.py's delete_travel_item rejects a scheduled travel
    item: a pin still referenced by a PlanItem has to be taken off the
    calendar first."""
    pin = db.get(Pin, pin_id)
    if not pin:
        raise HTTPException(status_code=404, detail="Pin not found")
    referenced = db.scalar(select(PlanItem).where(PlanItem.pin_id == pin_id))
    if referenced is not None:
        raise HTTPException(status_code=409, detail="This pin is scheduled in a plan — remove it from the schedule first")

    trip_id = pin.trip_id
    db.delete(pin)
    db.commit()
    bus.publish(trip_id, "pin.removed", {"pin_id": pin_id})
    return None


@router.put("/api/pins/{pin_id}/availability-rule")
def set_availability_rule(pin_id: int, payload: AvailabilityRuleIn, db: Session = Depends(get_db)):
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
    pin_id: int,
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
