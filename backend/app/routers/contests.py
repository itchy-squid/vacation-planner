from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Principal, get_current_contributor, get_current_principal
from ..db import get_db
from ..derive import item_duration_minutes, item_start_minutes
from ..events import bus
from ..models import Contest, ContestStatus, Contributor, Plan, PlanItem, PlanStatus, Vote
from ..tripclock import minutes_between, same_moment
from ..schemas import (
    ContestOut,
    ContestPlanOut,
    ContestProposeCreate,
    LockRequest,
    PlanItemCreate,
    PlanOut,
    VoteToggle,
)
from .plans import (
    _add_items,
    contributor_for_request,
    find_overlapping_plan,
    find_overlapping_plans,
    occupied_detail,
    plan_schema_kwargs,
)

router = APIRouter(prefix="/api", tags=["contests"])

# The statuses a proposal's window sweeps up into its incumbent option.
# `locked` is not among them — a locked plan is never inside a claimed
# window at all (see open_block_contest) — and `draft` is not among them
# because someone else's private draft must stay invisible, including to
# the capture that would otherwise silently delete it.
_CAPTURABLE_STATUSES = (PlanStatus.placed, PlanStatus.pencilled, PlanStatus.contested)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _set_letter(index: int) -> str:
    """A, B, C … and, past Z, AA/AB — spreadsheet-style rather than
    running out. A contest with 27 options is not a real scenario, but
    silently repeating "A" if one ever happened would be worse than a
    two-character letter."""
    letter = ""
    n = index
    while True:
        letter = chr(ord("A") + n % 26) + letter
        n = n // 26 - 1
        if n < 0:
            return letter


def _my_vote_plan_id(contest: Contest, request: Request | None, db: Session) -> int | None:
    """Best-effort: only set when the request carries an identifiable
    principal (Easy Auth headers in prod, DEV_USER_EMAIL locally) who is
    already a contributor on this trip. Never raises — an anonymous or
    unrecognized caller just sees no vote highlighted."""
    if request is None:
        return None
    contributor = contributor_for_request(db, contest.trip_id, request)
    if not contributor:
        return None
    vote = db.scalar(select(Vote).where(Vote.contest_id == contest.id, Vote.contributor_id == contributor.id))
    return vote.plan_id if vote else None


def _contest_plan_to_schema(plan: Plan, vote_count: int, voted_by_me: bool, set_letter: str) -> ContestPlanOut:
    return ContestPlanOut(
        **plan_schema_kwargs(plan),
        vote_count=vote_count,
        voted_by_me=voted_by_me,
        set_letter=set_letter,
    )


def _contest_to_schema(contest: Contest, db: Session, request: Request | None = None) -> ContestOut:
    my_vote_plan_id = _my_vote_plan_id(contest, request, db)
    vote_counts: dict[int, int] = {}
    for v in contest.votes:
        vote_counts[v.plan_id] = vote_counts.get(v.plan_id, 0) + 1

    # Letters follow creation order, so the incumbent — created first, and
    # first by id on any tie — is always A (feature spec §5.4).
    ordered = sorted(contest.plans, key=lambda p: (p.created_at, p.id))
    plans = [
        _contest_plan_to_schema(p, vote_counts.get(p.id, 0), p.id == my_vote_plan_id, _set_letter(i))
        for i, p in enumerate(ordered)
    ]
    contributor_count = len(db.scalars(select(Contributor).where(Contributor.trip_id == contest.trip_id)).all())

    # Strictly more than half. Advisory: the owner still locks, and nothing
    # here resolves the contest (feature spec decision 4).
    majority_plan_id = next(
        (p.id for p in ordered if contributor_count and vote_counts.get(p.id, 0) * 2 > contributor_count),
        None,
    )

    return ContestOut(
        id=contest.id,
        trip_id=contest.trip_id,
        status=contest.status.value,
        winning_plan_id=contest.winning_plan_id,
        starts_at=contest.starts_at,
        ends_at=contest.ends_at,
        plans=plans,
        voted_count=len(contest.votes),
        contributor_count=contributor_count,
        majority_plan_id=majority_plan_id,
        my_vote_plan_id=my_vote_plan_id,
    )


def _capture_into_incumbent(db: Session, contest: Contest, captured: list[Plan]) -> Plan | None:
    """Fold every plan already in the window into a single "on the board"
    option spanning the whole window.

    One option, not one per captured plan, because a contest resolves by
    locking exactly one of its options: if the hours held three plans and
    the group votes to keep things as they are, that has to be one thing to
    vote for. Each captured stop keeps its real clock time via an explicit
    offset_minutes, so a 14:00 dinner inside a 13:00–18:00 window still
    reads 14:00 on the compare screen instead of sliding to the window's
    start.

    Destructive in the same way locking already is: the captured plans are
    deleted, and reopening the contest later does not un-merge them. That
    matches the existing rule that reopening "does not restore any plans
    deleted at lock time" — see reopen_plan below."""
    if not captured:
        return None

    stops: list[tuple[int, int, int | None, int | None]] = []
    for plan in captured:
        base = minutes_between(plan.starts_at, contest.starts_at)
        for item in plan.items:
            stops.append(
                (
                    base + item_start_minutes(plan, item),
                    item_duration_minutes(item),
                    item.pin_id,
                    item.travel_item_id,
                )
            )
    stops.sort(key=lambda s: s[0])

    incumbent = Plan(
        trip_id=contest.trip_id,
        starts_at=contest.starts_at,
        ends_at=contest.ends_at,
        # Keeps whatever identity the board already had, so the "on the
        # board" column doesn't change colour the moment it's contested.
        label=captured[0].label,
        color=captured[0].color,
        status=PlanStatus.contested,
        contest_id=contest.id,
    )
    db.add(incumbent)
    db.flush()
    for position, (offset, duration, pin_id, travel_item_id) in enumerate(stops):
        db.add(
            PlanItem(
                plan_id=incumbent.id,
                pin_id=pin_id,
                travel_item_id=travel_item_id,
                position=position,
                duration_minutes=duration,
                offset_minutes=offset,
            )
        )

    for plan in captured:
        bus.publish(
            contest.trip_id,
            "plan.captured",
            {"plan_id": plan.id, "contest_id": contest.id, "incumbent_plan_id": incumbent.id},
        )
        db.delete(plan)
    db.flush()
    return incumbent


def open_block_contest(
    db: Session,
    trip_id: int,
    *,
    starts_at: datetime,
    ends_at: datetime,
    label: str,
    rationale: str,
    items: list[PlanItemCreate],
    contributor: Contributor | None,
) -> Contest:
    """The one server path behind both proposal entry points — the tray's
    four-step "Propose a block" flow and DaySchedule's quick tap-an-
    occupied-slot sheet, which is just this with a one-stop window (feature
    spec §6.6).

    Steps follow §6.2: find what's in the window, attach to an
    exactly-matching open contest or refuse a partial overlap, otherwise
    open a contest, capture the incumbents into one option, and add the
    proposal as another."""
    if ends_at <= starts_at:
        raise HTTPException(status_code=400, detail="A block has to end after it starts")
    if not items:
        raise HTTPException(status_code=400, detail="A block needs at least one stop")

    seen: set[tuple[str, int]] = set()
    for item in items:
        key = ("pin", item.pin_id) if item.pin_id is not None else ("travel", item.travel_item_id)
        if key in seen:
            raise HTTPException(status_code=400, detail="A block can only hold each item once")
        seen.add(key)

    window_minutes = minutes_between(ends_at, starts_at)
    planned = sum(item.duration_minutes or 0 for item in items)
    # Only checkable for stops that carry an explicit trim; an untrimmed
    # stop's duration lives on the pin, and is validated client-side where
    # the whole list is in hand. The structural guarantee — stops pack end
    # to end, so they can't overlap each other — holds either way.
    if planned > window_minutes:
        raise HTTPException(status_code=400, detail="Those stops don't fit in the hours you claimed")

    # A locked plan is a fixed hour, not a proposal: the ferry leaves when
    # it leaves. Step 2's drag clips the selection at one rather than
    # crossing it (feature spec §6.5), so reaching here means a race or a
    # client that skipped the clip — either way, refusing is what keeps
    # "everything in the window is in the contest" true.
    locked = find_overlapping_plans(db, trip_id, starts_at, ends_at, (PlanStatus.locked,))
    if locked:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Those hours contain a pinned item, so they can't be claimed.",
                "locked_plan_id": locked[0].id,
            },
        )

    overlapping = find_overlapping_plans(db, trip_id, starts_at, ends_at, _CAPTURABLE_STATUSES)

    open_contests: list[Contest] = []
    for plan in overlapping:
        if plan.contest_id is None:
            continue
        existing = db.get(Contest, plan.contest_id)
        if existing and existing.status == ContestStatus.open and existing not in open_contests:
            open_contests.append(existing)

    contest: Contest
    if open_contests:
        exact = [c for c in open_contests if same_moment(c.starts_at, starts_at) and same_moment(c.ends_at, ends_at)]
        if len(open_contests) > 1 or not exact:
            # Two contests can't share hours, and a half-overlapping
            # proposal would mean locking one could invalidate the other.
            # Naming the hours already out for a vote is what lets step 2
            # say which part of the drag is the problem.
            clash = open_contests[0]
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Some of those hours are already out for a vote.",
                    "contest_id": clash.id,
                    "starts_at": clash.starts_at.isoformat(),
                    "ends_at": clash.ends_at.isoformat(),
                },
            )
        # Exactly the same hours: this is a further option on the same
        # decision, which is how a SET C comes to exist.
        contest = exact[0]
    else:
        contest = Contest(
            trip_id=trip_id,
            status=ContestStatus.open,
            starts_at=starts_at,
            ends_at=ends_at,
        )
        db.add(contest)
        db.flush()
        _capture_into_incumbent(db, contest, overlapping)
        bus.publish(
            trip_id,
            "contest.opened",
            {
                "contest_id": contest.id,
                "starts_at": contest.starts_at.isoformat(),
                "ends_at": contest.ends_at.isoformat(),
            },
        )

    proposal = Plan(
        trip_id=trip_id,
        starts_at=starts_at,
        ends_at=ends_at,
        label=label,
        rationale=rationale,
        status=PlanStatus.contested,
        contest_id=contest.id,
        created_by_id=contributor.id if contributor else None,
    )
    db.add(proposal)
    db.flush()
    # offset_minutes stays NULL on every stop: a proposal's stops pack end
    # to end from the window start, which is what makes overlap between
    # them structurally impossible (feature spec §5.3).
    _add_items(db, proposal, items)
    db.flush()
    bus.publish(trip_id, "plan.placed", {"plan_id": proposal.id, "contest_id": contest.id})
    return contest


@router.post("/trips/{trip_id}/contests", response_model=ContestOut, status_code=201)
def propose_block(
    trip_id: int,
    payload: ContestProposeCreate,
    request: Request,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    """Propose an alternative for a range of hours. The proposal claims a
    window rather than targeting one existing plan — see
    open_block_contest above."""
    contributor = get_current_contributor(trip_id=trip_id, principal=principal, db=db)
    contest = open_block_contest(
        db,
        trip_id,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        label=payload.label,
        rationale=payload.rationale,
        items=payload.items,
        contributor=contributor,
    )
    db.commit()
    db.refresh(contest)
    return _contest_to_schema(contest, db, request)


@router.post("/plans/{plan_id}/publish", response_model=ContestOut, status_code=201)
def publish_plan(
    plan_id: int,
    request: Request,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    """Turn the caller's own draft block into a real proposal (feature spec
    §6.4). Author-only, and it runs the same window logic as a fresh
    proposal — so publishing can 409 if the hours went to a vote while the
    draft sat unpublished, and the client reopens the hour picker with that
    message."""
    plan = db.get(Plan, plan_id)
    if not plan or plan.status != PlanStatus.draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    viewer = contributor_for_request(db, plan.trip_id, request)
    if viewer is None or plan.created_by_id != viewer.id:
        # 404, not 403 — a draft belongs to its author alone, and this
        # shouldn't confirm that one exists at that id.
        raise HTTPException(status_code=404, detail="Draft not found")

    items = [
        PlanItemCreate(
            pin_id=item.pin_id,
            travel_item_id=item.travel_item_id,
            duration_minutes=item.duration_minutes,
        )
        for item in plan.items
    ]
    trip_id = plan.trip_id
    contest = open_block_contest(
        db,
        trip_id,
        starts_at=plan.starts_at,
        ends_at=plan.ends_at,
        label=plan.label,
        rationale=plan.rationale,
        items=items,
        contributor=viewer,
    )
    db.delete(plan)
    db.commit()
    db.refresh(contest)
    bus.publish(trip_id, "plan.published", {"contest_id": contest.id})
    return _contest_to_schema(contest, db, request)


@router.get("/contests/{contest_id}", response_model=ContestOut)
def get_contest(contest_id: int, request: Request, db: Session = Depends(get_db)):
    contest = db.get(Contest, contest_id)
    if not contest:
        raise HTTPException(status_code=404, detail="Contest not found")
    return _contest_to_schema(contest, db, request)


@router.post("/contests/{contest_id}/vote", response_model=ContestOut)
def toggle_vote(
    contest_id: int,
    payload: VoteToggle,
    request: Request,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    """One vote per contributor per contest, toggleable — voting for the
    plan you already voted for clears it; voting for a different plan in
    the contest replaces it (see spec "Voting")."""
    contest = db.get(Contest, contest_id)
    if not contest:
        raise HTTPException(status_code=404, detail="Contest not found")
    contributor = get_current_contributor(trip_id=contest.trip_id, principal=principal, db=db)

    existing = db.scalar(select(Vote).where(Vote.contest_id == contest_id, Vote.contributor_id == contributor.id))
    if existing and existing.plan_id == payload.plan_id:
        db.delete(existing)
    else:
        if existing:
            db.delete(existing)
            db.flush()
        db.add(Vote(contest_id=contest_id, plan_id=payload.plan_id, contributor_id=contributor.id))
    db.commit()
    bus.publish(contest.trip_id, "contest.vote_changed", {"contest_id": contest_id})
    db.refresh(contest)
    return _contest_to_schema(contest, db, request)


@router.post("/contests/{contest_id}/lock", response_model=ContestOut)
def lock_contest(
    contest_id: int,
    payload: LockRequest,
    request: Request,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    """Owner-only. Locks the given plan and deletes every other plan in
    the contest — the underlying pins/travel items are untouched and
    become unplaced again (see spec "Locking"). A majority in the tally is
    advisory; this is still what resolves the contest."""
    contest = db.get(Contest, contest_id)
    if not contest:
        raise HTTPException(status_code=404, detail="Contest not found")
    contributor = get_current_contributor(trip_id=contest.trip_id, principal=principal, db=db)
    if not contributor.is_owner:
        raise HTTPException(status_code=403, detail="Only the trip owner can lock a contest")

    winning = db.get(Plan, payload.plan_id)
    if not winning or winning.contest_id != contest_id:
        raise HTTPException(status_code=404, detail="That plan is not part of this contest")

    for p in list(contest.plans):
        if p.id == winning.id:
            p.status = PlanStatus.locked
        else:
            db.delete(p)
    contest.status = ContestStatus.resolved
    contest.winning_plan_id = winning.id
    contest.resolved_at = _now()
    db.commit()
    bus.publish(contest.trip_id, "contest.resolved", {"contest_id": contest_id, "plan_id": winning.id})
    db.refresh(contest)
    return _contest_to_schema(contest, db, request)


@router.post("/plans/{plan_id}/reopen", response_model=PlanOut)
def reopen_plan(
    plan_id: int,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    """Owner-only, only on a locked plan. Does not restore any plans
    deleted at lock time — a fresh alternative would need to be proposed
    again if wanted (see spec "Reopening")."""
    from .plans import plan_to_schema  # local import avoids a module cycle at import time

    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    if plan.status != PlanStatus.locked:
        raise HTTPException(status_code=409, detail="Only a locked plan can be reopened")
    contributor = get_current_contributor(trip_id=plan.trip_id, principal=principal, db=db)
    if not contributor.is_owner:
        raise HTTPException(status_code=403, detail="Only the trip owner can reopen a locked plan")

    # A locked plan's hours are inert, so nothing stopped someone placing
    # something in them once it was locked... except that locking is what
    # made them inert in the first place. Unlocking into hours that have
    # since been filled would create a silent overlap the calendar has no
    # way to draw, so refuse and name what's in the way instead (feature
    # spec §11).
    occupying = find_overlapping_plan(db, plan.trip_id, plan.starts_at, plan.ends_at, exclude_plan_id=plan.id)
    if occupying is not None:
        raise HTTPException(status_code=409, detail=occupied_detail(occupying))

    plan.status = PlanStatus.placed
    if plan.contest_id:
        contest = db.get(Contest, plan.contest_id)
        if contest:
            contest.status = ContestStatus.open
            contest.winning_plan_id = None
            contest.resolved_at = None
    db.commit()
    db.refresh(plan)
    bus.publish(plan.trip_id, "plan.reopened", {"plan_id": plan_id})
    return plan_to_schema(plan)
