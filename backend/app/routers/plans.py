from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from ..custom_events import forget_orphaned_travel_items, publish_forgotten, travel_item_ids_of
from ..db import get_db
from ..derive import item_money, item_source, item_start_minutes, plan_range_minutes, plan_totals, trip_roster
from ..events import bus
from ..models import OCCUPYING_STATUSES, Contributor, Pin, Plan, PlanItem, PlanStatus, TravelItem
from ..permissions import PLANS_DECIDE, PLANS_PROPOSE, PLANS_READ, PLANS_WRITE, Access, can_see_costs, require
from ..schemas import (
    PinOut,
    PlanCreate,
    PlanItemCreate,
    PlanItemOut,
    PlanMove,
    PlanOut,
    TravelItemOut,
)
from ..splits import audience, join_names, resolve_branch, traveler_rows

router = APIRouter(prefix="/api", tags=["plans"])

def visible_plans_condition(viewer: Contributor | None) -> ColumnElement[bool]:
    """The app's one per-contributor read filter: a draft plan belongs to
    its author alone (feature spec §6.4). Every plan-listing path goes
    through this single helper rather than spelling the condition out —
    a draft leaking onto someone else's calendar is exactly the kind of bug
    a second copy of this condition would eventually cause."""
    if viewer is None:
        return Plan.status != PlanStatus.draft
    return or_(Plan.status != PlanStatus.draft, Plan.created_by_id == viewer.id)


def _plan_item_to_schema(plan: Plan, item: PlanItem, roster: set[int]) -> PlanItemOut:
    start_minute_of_day = (
        plan.starts_at.hour * 60 + plan.starts_at.minute + item_start_minutes(plan, item)
    ) % 1440
    sharers, each, total = item_money(plan, item, roster)
    # Same visibility rule as the pin or travel item itself (a companion
    # sees the price only on what they added).
    visible = can_see_costs(item_source(item).added_by_id)
    return PlanItemOut(
        sharer_ids=sharers,
        each_cents=each if visible else None,
        total_cents=total if visible else None,
        pin=PinOut.model_validate(item.pin) if item.pin_id is not None else None,
        travel_item=TravelItemOut.model_validate(item.travel_item) if item.travel_item_id is not None else None,
        position=item.position,
        duration_minutes=item.duration_minutes,
        offset_minutes=item.offset_minutes,
        start_minute_of_day=start_minute_of_day,
    )


def plan_schema_kwargs(plan: Plan) -> dict:
    """Everything PlanOut needs, as keyword arguments rather than a built
    model — routers/contests.py builds a ContestPlanOut (PlanOut plus vote
    fields) from the same values. Handing it a dict rather than
    model_dump()ing a finished PlanOut matters: PinOut signs photo URLs on
    validation (see schemas.py), so round-tripping one through a dict would
    sign an already-signed URL a second time."""
    range_minutes = plan_range_minutes(plan)
    totals = plan_totals(plan, range_minutes)
    roster = trip_roster(plan)
    return dict(
        id=plan.id,
        trip_id=plan.trip_id,
        starts_at=plan.starts_at,
        ends_at=plan.ends_at,
        label=plan.label,
        color=plan.color,
        status=plan.status.value,
        contest_id=plan.contest_id,
        created_by_id=plan.created_by_id,
        rationale=plan.rationale,
        branch_id=plan.branch_id,
        party_members=sorted(audience(plan.branch, roster)),
        for_everyone=plan.branch_id is None,
        items=[_plan_item_to_schema(plan, i, roster) for i in plan.items],
        **totals,
    )


def plan_to_schema(plan: Plan) -> PlanOut:
    return PlanOut(**plan_schema_kwargs(plan))


def _overlapping(trip_id: int, starts_at, ends_at, branch_id: int | None, statuses):
    """Plans sharing a minute with these hours, for the same group. Any
    shared minute counts; a plan ending exactly when another starts does
    not conflict (see spec "Direct placement"). Same group is the whole of
    the "who" test — app/splits.py explains why that's enough."""
    return select(Plan).where(
        Plan.trip_id == trip_id,
        Plan.status.in_(statuses),
        Plan.starts_at < ends_at,
        Plan.ends_at > starts_at,
        Plan.branch_id.is_(None) if branch_id is None else Plan.branch_id == branch_id,
    )


def find_overlapping_plan(
    db: Session,
    trip_id: int,
    starts_at,
    ends_at,
    *,
    branch_id: int | None,
    exclude_plan_id: int | None = None,
) -> Plan | None:
    """The first plan already holding any of these hours for this group
    (None: everyone)."""
    stmt = _overlapping(trip_id, starts_at, ends_at, branch_id, OCCUPYING_STATUSES)
    if exclude_plan_id is not None:
        stmt = stmt.where(Plan.id != exclude_plan_id)
    return db.scalars(stmt.order_by(Plan.starts_at, Plan.id)).first()


def find_overlapping_plans(db: Session, trip_id: int, starts_at, ends_at, statuses, *, branch_id: int | None) -> list[Plan]:
    """Every plan in those hours for this group with one of `statuses`."""
    return list(db.scalars(_overlapping(trip_id, starts_at, ends_at, branch_id, statuses).order_by(Plan.starts_at, Plan.id)).all())


def occupied_detail(occupying: Plan, db: Session) -> dict:
    """The 409 body every placement path shares. `occupying_contest_id` is
    what lets a client offer "add a set to the open vote" instead of always
    opening a fresh propose sheet (feature spec §6.1).

    On a split day the message names who is busy — "Ana and Lin are
    already on Taroko Gorge then" is something a person can act on; "that
    time is occupied" on a day where half the group is visibly free is
    not."""
    message = "That time is already occupied."
    double_booked: list[str] = []
    if occupying.branch is not None:
        double_booked = [t.name for t in traveler_rows(db, occupying.branch.traveler_ids or ())]
        if double_booked:
            verb = "is" if len(double_booked) == 1 else "are"
            message = f"{join_names(double_booked)} {verb} already on {occupying.title} then."
    return {
        "message": message,
        "occupying_plan_id": occupying.id,
        "occupying_contest_id": occupying.contest_id,
        "double_booked": double_booked,
    }


def _add_items(db: Session, plan: Plan, items) -> None:
    for position, item in enumerate(items):
        db.add(
            PlanItem(
                plan_id=plan.id,
                pin_id=item.pin_id,
                travel_item_id=item.travel_item_id,
                position=position,
                duration_minutes=getattr(item, "duration_minutes", None),
                offset_minutes=getattr(item, "offset_minutes", None),
            )
        )


def ensure_unique_stops(items: list[PlanItemCreate]) -> None:
    """A pin or travel item may appear at most once in a plan (feature
    spec §11). Twice would mean two placements of one thing inside hours
    that are meant to be a single sequence, and every screen that resolves
    a stop back to its pin would have to pick one."""
    seen: set[tuple[str, int]] = set()
    for item in items:
        key = ("pin", item.pin_id) if item.pin_id is not None else ("travel", item.travel_item_id)
        if key in seen:
            raise HTTPException(status_code=400, detail="A block can only hold each item once")
        seen.add(key)


def stop_layout(db: Session, items: list[PlanItemCreate]) -> list[tuple[int, int, str]]:
    """(offset, duration, title) for each submitted stop, in the order
    given, with both nullable fields resolved exactly the way app/derive.py
    resolves the stored columns: a stop's own trim or the item's duration,
    an explicit offset or a packed one. Two resolutions of the same rule
    would be one too many — the number the client is shown while building a
    set has to be the number the server measures it by."""
    layout: list[tuple[int, int, str]] = []
    packed = 0
    for item in items:
        source = (
            db.get(Pin, item.pin_id) if item.pin_id is not None else db.get(TravelItem, item.travel_item_id)
        )
        if source is None:
            raise HTTPException(status_code=404, detail="One of those stops no longer exists")
        duration = item.duration_minutes if item.duration_minutes is not None else source.duration_minutes
        offset = item.offset_minutes if item.offset_minutes is not None else packed
        layout.append((offset, duration, source.title))
        # Packing counts durations only, never the gaps before them — same
        # as item_start_minutes, which sums the durations of earlier
        # positions and nothing else.
        packed += duration
    return layout


def validate_stop_layout(db: Session, items: list[PlanItemCreate], window_minutes: int) -> None:
    """Refuse a set of stops that can't happen: two at once, or one running
    past the end of the block.

    A block built by the propose screen can't express either — every stop
    sits after the one before it, with free time in between if it was asked
    for — so this is the backstop for a client that sends something else,
    and the single place the rule is written down for every path that
    builds a plan (a fresh proposal, a published draft, an edited set).

    Walked in the order submitted, not in clock order, so the list must
    also *be* in clock order. That is not pedantry: a stop with no time of
    its own follows the stops before it *by position* (app/derive.py), so a
    list whose order and times disagree has two answers for when it
    happens."""
    previous_end = 0
    previous_title = ""
    for offset, duration, title in stop_layout(db, items):
        if offset < previous_end:
            raise HTTPException(
                status_code=400,
                detail={
                    "message": f"{title} starts before {previous_title} has finished.",
                    "stop_title": title,
                },
            )
        if offset + duration > window_minutes:
            raise HTTPException(
                status_code=400,
                detail={
                    "message": f"{title} runs past the end of the block.",
                    "stop_title": title,
                },
            )
        previous_end = offset + duration
        previous_title = title


@router.get("/trips/{trip_id}/plans", response_model=list[PlanOut])
def list_plans(trip_id: int, access: Access = Depends(require(PLANS_READ)), db: Session = Depends(get_db)):
    viewer = access.member
    plans = db.scalars(
        select(Plan).where(Plan.trip_id == trip_id, visible_plans_condition(viewer))
    ).all()
    return [plan_to_schema(p) for p in plans]


@router.get("/plans/{plan_id}", response_model=PlanOut)
def get_plan(plan_id: int, access: Access = Depends(require(PLANS_READ)), db: Session = Depends(get_db)):
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    if plan.status == PlanStatus.draft:
        # 404 rather than 403: someone else's draft shouldn't even confirm
        # that a plan exists at that id.
        if plan.created_by_id != access.member.id:
            raise HTTPException(status_code=404, detail="Plan not found")
    return plan_to_schema(plan)


@router.post("/trips/{trip_id}/plans", response_model=PlanOut, status_code=201)
def create_plan(
    trip_id: int,
    payload: PlanCreate,
    access: Access = Depends(require(PLANS_PROPOSE)),
    db: Session = Depends(get_db),
):
    """Direct placement, or — with status "draft" — the private, unclaimed
    kind. A caller who gets the 409 below should switch to the propose-a-
    block flow (POST /api/trips/{trip_id}/contests) instead of retrying
    this endpoint, or, when the 409 carries an occupying_contest_id, offer
    to add a set to the vote that's already open there."""
    is_draft = payload.status == "draft"
    # Checked for drafts too: a draft for the wrong hours of a group would
    # only fail later, when it's published.
    branch = resolve_branch(db, trip_id, payload.branch_id, payload.starts_at, payload.ends_at)
    branch_id = branch.id if branch else None
    if not is_draft:
        # A draft is the start of a proposal (plans:propose); putting
        # something straight onto the calendar is plans:write.
        access.ensure(PLANS_WRITE, "Propose a block instead — you can't place things on the calendar directly")
        # A draft skips this entirely: it claims no time, so there is
        # nothing for it to conflict with (feature spec §6.4).
        occupying = find_overlapping_plan(db, trip_id, payload.starts_at, payload.ends_at, branch_id=branch_id)
        if occupying is not None:
            raise HTTPException(status_code=409, detail=occupied_detail(occupying, db))

    plan = Plan(
        trip_id=trip_id,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        label=payload.label,
        rationale=payload.rationale,
        branch_id=branch_id,
        status=PlanStatus(payload.status),
        created_by_id=access.member.id,
    )
    db.add(plan)
    db.flush()
    _add_items(db, plan, payload.items)
    db.commit()
    db.refresh(plan)
    # A draft is never broadcast — nobody else can see it, so telling the
    # whole trip about it would only make other clients refetch for nothing.
    if not is_draft:
        bus.publish(trip_id, "plan.placed", {"plan_id": plan.id})
    return plan_to_schema(plan)


@router.patch("/plans/{plan_id}", response_model=PlanOut)
def move_plan(
    plan_id: int,
    payload: PlanMove,
    _: Access = Depends(require(PLANS_WRITE)),
    db: Session = Depends(get_db),
):
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    if plan.status not in (PlanStatus.placed, PlanStatus.pencilled):
        raise HTTPException(status_code=409, detail="Only a placed or pencilled plan can be moved")

    new_starts = payload.starts_at if payload.starts_at is not None else plan.starts_at
    new_ends = payload.ends_at if payload.ends_at is not None else plan.ends_at
    # A group's plan stays inside its split; a plan for everyone stays out
    # of every split (app/splits.py).
    resolve_branch(db, plan.trip_id, plan.branch_id, new_starts, new_ends)
    occupying = find_overlapping_plan(db, plan.trip_id, new_starts, new_ends, branch_id=plan.branch_id, exclude_plan_id=plan.id)
    if occupying is not None:
        raise HTTPException(status_code=409, detail=occupied_detail(occupying, db))

    plan.starts_at = new_starts
    plan.ends_at = new_ends
    db.commit()
    db.refresh(plan)
    bus.publish(plan.trip_id, "plan.moved", {"plan_id": plan.id})
    return plan_to_schema(plan)


@router.delete("/plans/{plan_id}", status_code=204)
def delete_plan(
    plan_id: int,
    access: Access = Depends(require(PLANS_PROPOSE)),
    db: Session = Depends(get_db),
):
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    if plan.status == PlanStatus.draft:
        # Discarding your own draft block. Author-only for the same reason
        # reading one is: it isn't anyone else's to throw away. 404, not
        # 403, to match get_plan.
        if plan.created_by_id != access.member.id:
            raise HTTPException(status_code=404, detail="Plan not found")
    else:
        access.ensure(PLANS_WRITE)
        if plan.status not in (PlanStatus.placed, PlanStatus.pencilled):
            raise HTTPException(status_code=409, detail="Only a placed or pencilled plan can be unplaced")

    trip_id = plan.trip_id
    was_draft = plan.status == PlanStatus.draft
    # Removing a plan from the calendar (or discarding a draft) takes its
    # custom events with it rather than dropping them into the unplaced
    # list — see app/custom_events.py. Pins are untouched and go back to
    # the tray as before.
    orphan_candidates = travel_item_ids_of([plan])
    db.delete(plan)
    forgotten = forget_orphaned_travel_items(db, orphan_candidates)
    db.commit()
    if not was_draft:
        bus.publish(trip_id, "plan.removed", {"plan_id": plan_id})
    publish_forgotten(forgotten)
    return None


@router.post("/plans/{plan_id}/lock", response_model=PlanOut)
def lock_plan(
    plan_id: int,
    _: Access = Depends(require(PLANS_DECIDE)),
    db: Session = Depends(get_db),
):
    """Owner-only. Locks a placed/pencilled plan directly, with no contest
    involved — the reversible companion to reopen_plan
    (routers/contests.py). A contested plan must still go through
    POST /api/contests/{contest_id}/pick instead, since that's what also
    settles the contest and cleans up its options; this endpoint
    409s that case away by only ever accepting placed/pencilled (see spec
    "Locking").

    This is also how a pinned item — the ferry crossing, the handoff's
    gangway times — comes to exist: there is no separate "pinned" concept,
    just a locked plan, which the proposal flow's hour selection then clips
    at rather than claiming (feature spec §6.5)."""
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    if plan.status not in (PlanStatus.placed, PlanStatus.pencilled):
        raise HTTPException(status_code=409, detail="Only a placed or pencilled plan can be locked directly")

    plan.status = PlanStatus.locked
    db.commit()
    db.refresh(plan)
    bus.publish(plan.trip_id, "plan.locked", {"plan_id": plan.id})
    return plan_to_schema(plan)
