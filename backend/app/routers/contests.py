from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_contributor, get_current_principal, get_principal
from ..db import get_db
from ..derive import plan_range_minutes, plan_totals
from ..events import bus
from ..models import Contest, ContestStatus, Contributor, Plan, PlanStatus, Vote
from ..schemas import ContestOut, ContestPlanOut, ContestProposeCreate, LockRequest, PlanOut, VoteToggle
from .plans import _add_items, _plan_item_to_schema

router = APIRouter(prefix="/api", tags=["contests"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _my_vote_plan_id(contest: Contest, request: Request | None, db: Session) -> int | None:
    """Best-effort: only set when the request carries an identifiable
    principal (Easy Auth headers in prod, DEV_USER_EMAIL locally) who is
    already a contributor on this trip. Never raises — an anonymous or
    unrecognized caller just sees no vote highlighted. Mirrors the old
    blocks router's _my_vote_candidate_set_id."""
    if request is None:
        return None
    principal = get_principal(request)
    if principal is None:
        from ..config import get_settings

        settings = get_settings()
        if not settings.is_development:
            return None
        principal_email = settings.dev_user_email
    else:
        principal_email = principal.email

    contributor = db.scalar(
        select(Contributor).where(Contributor.trip_id == contest.trip_id, Contributor.email == principal_email)
    )
    if not contributor:
        return None
    vote = db.scalar(select(Vote).where(Vote.contest_id == contest.id, Vote.contributor_id == contributor.id))
    return vote.plan_id if vote else None


def _contest_plan_to_schema(plan: Plan, vote_count: int, voted_by_me: bool) -> ContestPlanOut:
    range_minutes = plan_range_minutes(plan)
    totals = plan_totals(plan, range_minutes)
    return ContestPlanOut(
        id=plan.id,
        trip_id=plan.trip_id,
        starts_at=plan.starts_at,
        ends_at=plan.ends_at,
        label=plan.label,
        color=plan.color,
        status=plan.status.value,
        contest_id=plan.contest_id,
        items=[_plan_item_to_schema(i) for i in plan.items],
        vote_count=vote_count,
        voted_by_me=voted_by_me,
        **totals,
    )


def _contest_to_schema(contest: Contest, db: Session, request: Request | None = None) -> ContestOut:
    my_vote_plan_id = _my_vote_plan_id(contest, request, db)
    vote_counts: dict[int, int] = {}
    for v in contest.votes:
        vote_counts[v.plan_id] = vote_counts.get(v.plan_id, 0) + 1

    plans = [
        _contest_plan_to_schema(p, vote_counts.get(p.id, 0), p.id == my_vote_plan_id)
        for p in contest.plans
    ]
    contributor_count = len(db.scalars(select(Contributor).where(Contributor.trip_id == contest.trip_id)).all())

    return ContestOut(
        id=contest.id,
        trip_id=contest.trip_id,
        status=contest.status.value,
        winning_plan_id=contest.winning_plan_id,
        plans=plans,
        voted_count=len(contest.votes),
        contributor_count=contributor_count,
        my_vote_plan_id=my_vote_plan_id,
    )


@router.post("/trips/{trip_id}/contests", response_model=ContestOut, status_code=201)
def propose_alternative(
    trip_id: int,
    payload: ContestProposeCreate,
    request: Request,
    principal=Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    """Propose a competing plan against an already-placed one. The new
    plan's time range only needs to overlap the target's, not match it —
    see spec "Proposing an alternative"."""
    target = db.get(Plan, payload.against_plan_id)
    if not target or target.trip_id != trip_id:
        raise HTTPException(status_code=404, detail="Plan not found on this trip")
    if target.status == PlanStatus.locked:
        raise HTTPException(status_code=403, detail="This plan is locked — reopen it before proposing an alternative")

    if target.contest_id:
        contest = db.get(Contest, target.contest_id)
    else:
        contest = Contest(trip_id=trip_id, status=ContestStatus.open)
        db.add(contest)
        db.flush()
        target.contest_id = contest.id
        target.status = PlanStatus.contested
        bus.publish(trip_id, "contest.opened", {"contest_id": contest.id, "plan_id": target.id})

    contributor = get_current_contributor(trip_id=trip_id, principal=principal, db=db)
    new_plan = Plan(
        trip_id=trip_id,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        status=PlanStatus.contested,
        contest_id=contest.id,
        created_by_id=contributor.id if contributor else None,
    )
    db.add(new_plan)
    db.flush()
    _add_items(db, new_plan, payload.items)
    db.commit()
    db.refresh(contest)
    bus.publish(trip_id, "plan.placed", {"plan_id": new_plan.id, "contest_id": contest.id})
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
    principal=Depends(get_current_principal),
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
    principal=Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    """Owner-only. Locks the given plan and deletes every other plan in
    the contest — the underlying pins/travel items are untouched and
    become unplaced again (see spec "Locking")."""
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
    principal=Depends(get_current_principal),
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
