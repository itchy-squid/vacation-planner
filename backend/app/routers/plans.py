from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_contributor, get_current_principal
from ..db import get_db
from ..derive import plan_range_minutes, plan_totals
from ..events import bus
from ..models import Plan, PlanItem, PlanStatus
from ..schemas import PinOut, PlanCreate, PlanItemOut, PlanMove, PlanOut, TravelItemOut

router = APIRouter(prefix="/api", tags=["plans"])

# Any plan in one of these statuses occupies real time on the trip's
# calendar and can conflict with a new placement — see docs/features/
# scheduling-feature-spec.md "Direct placement".
_OCCUPYING_STATUSES = (PlanStatus.placed, PlanStatus.pencilled, PlanStatus.contested, PlanStatus.locked)


def _plan_item_to_schema(item: PlanItem) -> PlanItemOut:
    return PlanItemOut(
        pin=PinOut.model_validate(item.pin) if item.pin_id is not None else None,
        travel_item=TravelItemOut.model_validate(item.travel_item) if item.travel_item_id is not None else None,
        position=item.position,
    )


def plan_to_schema(plan: Plan) -> PlanOut:
    range_minutes = plan_range_minutes(plan)
    totals = plan_totals(plan, range_minutes)
    return PlanOut(
        id=plan.id,
        trip_id=plan.trip_id,
        starts_at=plan.starts_at,
        ends_at=plan.ends_at,
        label=plan.label,
        color=plan.color,
        status=plan.status.value,
        contest_id=plan.contest_id,
        items=[_plan_item_to_schema(i) for i in plan.items],
        **totals,
    )


def find_overlapping_plan(db: Session, trip_id: int, starts_at, ends_at, exclude_plan_id: int | None = None) -> Plan | None:
    """Any shared minute counts as overlap — a plan ending exactly when
    another starts does not conflict (see spec "Direct placement")."""
    stmt = select(Plan).where(
        Plan.trip_id == trip_id,
        Plan.status.in_(_OCCUPYING_STATUSES),
        Plan.starts_at < ends_at,
        Plan.ends_at > starts_at,
    )
    if exclude_plan_id is not None:
        stmt = stmt.where(Plan.id != exclude_plan_id)
    return db.scalar(stmt)


def _add_items(db: Session, plan: Plan, items) -> None:
    for position, item in enumerate(items):
        db.add(PlanItem(plan_id=plan.id, pin_id=item.pin_id, travel_item_id=item.travel_item_id, position=position))


@router.get("/trips/{trip_id}/plans", response_model=list[PlanOut])
def list_plans(trip_id: int, db: Session = Depends(get_db)):
    plans = db.scalars(select(Plan).where(Plan.trip_id == trip_id)).all()
    return [plan_to_schema(p) for p in plans]


@router.post("/trips/{trip_id}/plans", response_model=PlanOut, status_code=201)
def create_plan(
    trip_id: int,
    payload: PlanCreate,
    principal=Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    """Direct placement. A caller who gets the 409 below should switch to
    the propose-alternative flow (POST /api/trips/{trip_id}/contests)
    instead of retrying this endpoint — see spec "Direct placement"."""
    occupying = find_overlapping_plan(db, trip_id, payload.starts_at, payload.ends_at)
    if occupying is not None:
        raise HTTPException(
            status_code=409,
            detail={"message": "That time is already occupied.", "occupying_plan_id": occupying.id},
        )

    contributor = get_current_contributor(trip_id=trip_id, principal=principal, db=db)
    plan = Plan(
        trip_id=trip_id,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        status=PlanStatus(payload.status),
        created_by_id=contributor.id if contributor else None,
    )
    db.add(plan)
    db.flush()
    _add_items(db, plan, payload.items)
    db.commit()
    db.refresh(plan)
    bus.publish(trip_id, "plan.placed", {"plan_id": plan.id})
    return plan_to_schema(plan)


@router.patch("/plans/{plan_id}", response_model=PlanOut)
def move_plan(plan_id: int, payload: PlanMove, db: Session = Depends(get_db)):
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    if plan.status not in (PlanStatus.placed, PlanStatus.pencilled):
        raise HTTPException(status_code=409, detail="Only a placed or pencilled plan can be moved")

    new_starts = payload.starts_at if payload.starts_at is not None else plan.starts_at
    new_ends = payload.ends_at if payload.ends_at is not None else plan.ends_at
    occupying = find_overlapping_plan(db, plan.trip_id, new_starts, new_ends, exclude_plan_id=plan.id)
    if occupying is not None:
        raise HTTPException(
            status_code=409,
            detail={"message": "That time is already occupied.", "occupying_plan_id": occupying.id},
        )

    plan.starts_at = new_starts
    plan.ends_at = new_ends
    db.commit()
    db.refresh(plan)
    bus.publish(plan.trip_id, "plan.moved", {"plan_id": plan.id})
    return plan_to_schema(plan)


@router.delete("/plans/{plan_id}", status_code=204)
def delete_plan(plan_id: int, db: Session = Depends(get_db)):
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    if plan.status not in (PlanStatus.placed, PlanStatus.pencilled):
        raise HTTPException(status_code=409, detail="Only a placed or pencilled plan can be unplaced")

    trip_id = plan.trip_id
    db.delete(plan)
    db.commit()
    bus.publish(trip_id, "plan.removed", {"plan_id": plan_id})
    return None
