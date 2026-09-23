from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from ..custom_events import forget_orphaned_travel_items, publish_forgotten, travel_item_ids_of
from ..db import get_db
from ..derive import item_money, item_source, item_start_minutes, plan_range_minutes, plan_totals, trip_roster
from ..events import bus
from ..models import Contributor, Pin, Plan, PlanItem, PlanStatus, TravelItem, Traveler
from ..party import EXCEPT, ONLY, Party, apply_party, encode, normalize_party, parties_meet, party_of, roster_ids, shared_people
from ..permissions import PLANS_DECIDE, PLANS_JOIN, PLANS_PROPOSE, PLANS_READ, PLANS_WRITE, Access, can_see_costs, require
from ..schemas import (
    PinOut,
    PlanCreate,
    PlanItemCreate,
    PlanItemOut,
    PlanMove,
    PlanOut,
    PlanPartySet,
    PlanSplit,
    TravelItemOut,
)

router = APIRouter(prefix="/api", tags=["plans"])

# Any plan in one of these statuses occupies real time on the trip's
# calendar and can conflict with a new placement — see docs/features/
# scheduling-feature-spec.md "Direct placement". `draft` is deliberately
# absent: a private draft nobody else can see must not be able to block
# anybody else's placement (proposals-and-expenses spec §6.1).
_OCCUPYING_STATUSES = (PlanStatus.placed, PlanStatus.pencilled, PlanStatus.contested, PlanStatus.locked)


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
    party = party_of(plan)
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
        party=list(party.ids),
        party_mode=party.mode,
        party_members=sorted(party.members(roster)),
        for_everyone=party.is_everyone,
        items=[_plan_item_to_schema(plan, i, roster) for i in plan.items],
        **totals,
    )


def plan_to_schema(plan: Plan) -> PlanOut:
    return PlanOut(**plan_schema_kwargs(plan))


def find_overlapping_plan(
    db: Session,
    trip_id: int,
    starts_at,
    ends_at,
    exclude_plan_id: int | None = None,
    party: Party | None = None,
) -> Plan | None:
    """Any shared minute counts as overlap — a plan ending exactly when
    another starts does not conflict (see spec "Direct placement").

    ...and only for a plan someone is, or would be, on twice
    (app/party.py parties_meet). `party` is who the new or moved plan is
    for; None is everyone, which meets every plan and keeps the old rule.
    The time filter stays in SQL and the party test runs here: a trip has a
    handful of plans in any window, and JSON containment is spelled
    differently by every dialect this app runs on."""
    stmt = select(Plan).where(
        Plan.trip_id == trip_id,
        Plan.status.in_(_OCCUPYING_STATUSES),
        Plan.starts_at < ends_at,
        Plan.ends_at > starts_at,
    )
    if exclude_plan_id is not None:
        stmt = stmt.where(Plan.id != exclude_plan_id)
    roster = roster_ids(db, trip_id)
    for plan in db.scalars(stmt.order_by(Plan.starts_at, Plan.id)):
        if parties_meet(party_of(plan), party, roster):
            return plan
    return None


def find_overlapping_plans(db: Session, trip_id: int, starts_at, ends_at, statuses, party: Party | None = None) -> list[Plan]:
    """Every plan in those hours with one of `statuses` that shares a
    person with `party` (None for everyone, which is every plan)."""
    roster = roster_ids(db, trip_id)
    return [
        plan
        for plan in db.scalars(
            select(Plan)
            .where(
                Plan.trip_id == trip_id,
                Plan.status.in_(statuses),
                Plan.starts_at < ends_at,
                Plan.ends_at > starts_at,
            )
            .order_by(Plan.starts_at, Plan.id)
        ).all()
        if parties_meet(party_of(plan), party, roster)
    ]


def plan_title(plan: Plan) -> str:
    """What a person would call this plan: its name, else its first stop."""
    if plan.label:
        return plan.label
    for item in plan.items:
        source = item.pin or item.travel_item
        if source is not None:
            return source.title
    return "another plan"


def occupied_detail(occupying: Plan, db: Session | None = None, party: Party | None = None) -> dict:
    """The 409 body every placement path shares. `occupying_contest_id` is
    what lets a client offer "add a set to the open vote" instead of always
    opening a fresh propose sheet (feature spec §6.1).

    When either side is for part of the group, the message names who is
    double-booked — "Jae is already on Liyu Lake bike loop then" is
    something a person can act on; "that time is occupied" on a day where
    half the group is visibly free is not."""
    message = "That time is already occupied."
    double_booked: list[str] = []
    theirs = party_of(occupying)
    if db is not None and not (theirs.is_everyone and (party is None or party.is_everyone)):
        double_booked = shared_people(db, occupying.trip_id, theirs, party)
        if double_booked:
            who = double_booked[0] if len(double_booked) == 1 else ", ".join(double_booked[:-1]) + " and " + double_booked[-1]
            verb = "is" if len(double_booked) == 1 else "are"
            message = f"{who} {verb} already on {plan_title(occupying)} then."
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
    party = normalize_party(db, trip_id, payload.party, payload.party_mode)
    if not is_draft:
        # A draft is the start of a proposal (plans:propose); putting
        # something straight onto the calendar is plans:write.
        access.ensure(PLANS_WRITE, "Propose a block instead — you can't place things on the calendar directly")
        # A draft skips this entirely: it claims no time, so there is
        # nothing for it to conflict with (feature spec §6.4).
        occupying = find_overlapping_plan(db, trip_id, payload.starts_at, payload.ends_at, party=party)
        if occupying is not None:
            raise HTTPException(status_code=409, detail=occupied_detail(occupying, db, party))

    plan = Plan(
        trip_id=trip_id,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        label=payload.label,
        rationale=payload.rationale,
        party=list(party.ids),
        party_mode=party.mode,
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
    occupying = find_overlapping_plan(db, plan.trip_id, new_starts, new_ends, exclude_plan_id=plan.id, party=party_of(plan))
    if occupying is not None:
        raise HTTPException(status_code=409, detail=occupied_detail(occupying, db, party_of(plan)))

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
    keep_group = not was_draft and bool(plan.items) and _is_split_group(db, plan)
    if keep_group:
        # One group of a split day: clear what it was doing but keep the
        # group, empty, exactly as a fresh split leaves it. Deleting the
        # plan outright would leave its people on no plan at all in those
        # hours, next to another group's plan — and every way into those
        # hours (tapping, proposing, placing) lands on that other group, so
        # nobody could plan for them again without clearing the whole
        # block. Removing the now-empty group is a second, deliberate step
        # (the "bring everyone back" path).
        plan.items.clear()
    else:
        db.delete(plan)
    forgotten = forget_orphaned_travel_items(db, orphan_candidates)
    db.commit()
    if keep_group:
        bus.publish(trip_id, "plan.cleared", {"plan_id": plan_id})
    elif not was_draft:
        bus.publish(trip_id, "plan.removed", {"plan_id": plan_id})
    publish_forgotten(forgotten)
    return None


def _is_split_group(db: Session, plan: Plan) -> bool:
    """Whether this plan is one group of a split: it's for part of the
    trip, and some other group has a plan over the same hours."""
    party = party_of(plan)
    if party.is_everyone:
        return False
    roster = roster_ids(db, plan.trip_id)
    others = db.scalars(
        select(Plan).where(
            Plan.trip_id == plan.trip_id,
            Plan.id != plan.id,
            Plan.status.in_(_OCCUPYING_STATUSES),
            Plan.starts_at < plan.ends_at,
            Plan.ends_at > plan.starts_at,
        )
    )
    return any(not parties_meet(party_of(other), party, roster) for other in others)


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


# ---- Split-party plans (app/party.py) ----
#
# A split is not a row. It is two or more plans over the same hours whose
# parties don't share a person, so these endpoints only ever change who a
# plan is for. The overlap rule does the rest.

_REPARTY_STATUSES = (PlanStatus.placed, PlanStatus.pencilled)


def _ensure_repartyable(plan: Plan, verb: str) -> None:
    """Who a plan is for can change while it's simply on the calendar.
    Not while it's an option in a vote (the vote's party is the question
    being asked — settle it first, the same way the hours are never edited
    under a vote), and not once the owner has pinned it."""
    if plan.status == PlanStatus.contested:
        raise HTTPException(status_code=409, detail=f"Those hours are out for a vote. Settle it before you {verb}.")
    if plan.status == PlanStatus.locked:
        raise HTTPException(status_code=409, detail=f"{plan_title(plan)} is pinned. The trip owner has to reopen it before you {verb}.")
    if plan.status not in _REPARTY_STATUSES:
        raise HTTPException(status_code=409, detail="Only a plan on the calendar can be changed like that.")


@router.post("/plans/{plan_id}/split", response_model=list[PlanOut], status_code=201)
def split_plan(
    plan_id: int,
    payload: PlanSplit,
    access: Access = Depends(require(PLANS_WRITE)),
    db: Session = Depends(get_db),
):
    """Split the group over this plan's hours. The travelers in `leaving`
    come off this plan and get a new, empty plan of their own for the same
    hours; everyone else stays. Both come back, this plan first.

    `newcomers` says which side anyone added to the trip later joins: the
    new group (the default), this plan, or neither. That side is stored as
    "everyone except the other side" (app/party.py), so a traveler added
    next week is on it without anything being written.

    One call, so there is never a moment where the leavers are on both
    plans (which the overlap rule forbids) or on neither (which would
    quietly drop them from the day)."""
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    _ensure_repartyable(plan, "split the group")

    trip_id = plan.trip_id
    roster = roster_ids(db, trip_id)
    on_plan = party_of(plan).members(roster)
    leaving = set(payload.leaving)
    if not leaving <= on_plan:
        raise HTTPException(status_code=400, detail="Only people on this plan can split off from it")
    staying = on_plan - leaving
    if not staying:
        raise HTTPException(status_code=400, detail="Someone has to stay on this plan. To hand it to different people, change who it's for instead.")

    def side(members: set[int], takes_newcomers: bool) -> Party:
        """The stored party for one side. The newcomers' side is "except",
        unless some other plan in these hours already is — then newcomers
        already have somewhere to be at that time, and this side stays an
        exact list rather than double-booking them."""
        if takes_newcomers:
            wanted = encode(members, roster, EXCEPT)
            if find_overlapping_plan(db, trip_id, plan.starts_at, plan.ends_at, exclude_plan_id=plan.id, party=wanted) is None:
                return wanted
        return encode(members, roster, ONLY)

    branch_party = side(leaving, payload.newcomers == "leave")
    stay_party = side(staying, payload.newcomers == "stay")
    # Everyone who isn't on either side is already somewhere else then, so
    # only the leavers can be double-booked by the new plan.
    occupying = find_overlapping_plan(db, trip_id, plan.starts_at, plan.ends_at, exclude_plan_id=plan.id, party=branch_party)
    if occupying is not None:
        raise HTTPException(status_code=409, detail=occupied_detail(occupying, db, branch_party))

    apply_party(plan, stay_party)
    branch = Plan(
        trip_id=trip_id,
        starts_at=plan.starts_at,
        ends_at=plan.ends_at,
        label=payload.label,
        color=plan.color,
        status=PlanStatus.placed,
        party=list(branch_party.ids),
        party_mode=branch_party.mode,
        created_by_id=access.member.id,
    )
    db.add(branch)
    db.commit()
    db.refresh(plan)
    db.refresh(branch)
    bus.publish(trip_id, "plan.split", {"plan_id": plan.id, "branch_plan_id": branch.id})
    return [plan_to_schema(plan), plan_to_schema(branch)]


@router.put("/plans/{plan_id}/party", response_model=PlanOut)
def set_plan_party(
    plan_id: int,
    payload: PlanPartySet,
    access: Access = Depends(require(PLANS_WRITE)),
    db: Session = Depends(get_db),
):
    """Say who a plan is for: traveler ids read through party_mode
    ("only", the default, or "except" — everyone but these, including
    anyone added later). [] with "only" is everyone, which is how a group
    is brought back together with the rest once the other group's plans in
    those hours are gone. A 409 names who would be double-booked, so
    moving someone between groups is: take them off one, then put them on
    the other."""
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    _ensure_repartyable(plan, "change who it's for")

    party = normalize_party(db, plan.trip_id, payload.party, payload.party_mode)
    occupying = find_overlapping_plan(db, plan.trip_id, plan.starts_at, plan.ends_at, exclude_plan_id=plan.id, party=party)
    if occupying is not None:
        raise HTTPException(status_code=409, detail=occupied_detail(occupying, db, party))

    apply_party(plan, party)
    db.commit()
    db.refresh(plan)
    bus.publish(plan.trip_id, "plan.party_changed", {"plan_id": plan.id})
    return plan_to_schema(plan)


def my_traveler(db: Session, access: Access) -> Traveler | None:
    return db.scalar(select(Traveler).where(Traveler.trip_id == access.trip_id, Traveler.contributor_id == access.member.id))


@router.post("/plans/{plan_id}/join", response_model=list[PlanOut])
def join_plan(
    plan_id: int,
    access: Access = Depends(require(PLANS_JOIN)),
    db: Session = Depends(get_db),
):
    """Move yourself onto this group of a split day: "I'm going with
    Ana." You come off whatever else you were on at the same time, and
    nobody else's place changes. This is the one party change a companion
    can make, and only for themselves — as the traveler linked to them.

    Returns this plan first, then every plan you left."""
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    _ensure_repartyable(plan, "join it")
    me_row = my_traveler(db, access)
    if me_row is None:
        raise HTTPException(status_code=409, detail="You're not listed as a traveler on this trip, so there's no group to move.")
    me = me_row.id
    trip_id = plan.trip_id
    roster = roster_ids(db, trip_id)
    target = party_of(plan)
    if target.is_everyone:
        raise HTTPException(status_code=409, detail="That plan is already for everyone")
    if me in target.members(roster):
        return [plan_to_schema(plan)]

    mine = Party(ONLY, (me,))
    leaving_from = [
        other
        for other in find_overlapping_plans(db, trip_id, plan.starts_at, plan.ends_at, _OCCUPYING_STATUSES, party=mine)
        if other.id != plan.id
    ]
    for other in leaving_from:
        theirs = party_of(other)
        if theirs.is_everyone:
            # Can't happen while the overlap rule holds: an everyone-plan
            # and a group at the same time would already collide.
            raise HTTPException(status_code=409, detail=f"You're on {plan_title(other)} with everyone then.")
        _ensure_repartyable(other, "move off it")
        if theirs.members(roster) == {me}:
            raise HTTPException(
                status_code=409,
                detail=f"You're the only one on {plan_title(other)}. Remove it, or ask a planner to, before you join another group.",
            )

    for other in leaving_from:
        theirs = party_of(other)
        apply_party(other, encode(theirs.members(roster) - {me}, roster, theirs.mode))
    apply_party(plan, encode(target.members(roster) | {me}, roster, target.mode))
    db.flush()
    # Belt and braces: after the moves, nobody may be on two things at once.
    clash = find_overlapping_plan(db, trip_id, plan.starts_at, plan.ends_at, exclude_plan_id=plan.id, party=party_of(plan))
    if clash is not None:
        db.rollback()
        raise HTTPException(status_code=409, detail=occupied_detail(clash, db, mine))

    db.commit()
    for p in [plan, *leaving_from]:
        db.refresh(p)
        bus.publish(trip_id, "plan.party_changed", {"plan_id": p.id})
    return [plan_to_schema(plan), *(plan_to_schema(p) for p in leaving_from)]
