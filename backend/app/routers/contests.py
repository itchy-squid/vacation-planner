from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..custom_events import forget_orphaned_travel_items, publish_forgotten, travel_item_ids_of
from ..db import get_db
from ..derive import item_duration_minutes, item_start_minutes
from ..events import bus
from ..models import Contest, ContestStatus, Contributor, Plan, PlanItem, PlanStatus, Vote
from ..party import names, normalize_party
from ..permissions import PLANS_DECIDE, PLANS_PROPOSE, PLANS_READ, VOTES_WRITE, VOTING_ROLES, Access, require
from ..tripclock import minutes_between, same_moment
from ..schemas import (
    ContestOut,
    ContestPlanOut,
    ContestProposeCreate,
    ContestPicked,
    PlanItemCreate,
    PickRequest,
    PlanOut,
    ProposalUpdate,
    VoteToggle,
)
from .plans import (
    _add_items,
    ensure_unique_stops,
    find_overlapping_plan,
    find_overlapping_plans,
    occupied_detail,
    plan_schema_kwargs,
    validate_stop_layout,
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


def _my_vote_plan_id(contest: Contest, contributor: Contributor | None, db: Session) -> int | None:
    """The plan `contributor` voted for in this contest, if any."""
    if contributor is None:
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


def _contest_to_schema(contest: Contest, db: Session, viewer: Contributor | None = None) -> ContestOut:
    my_vote_plan_id = _my_vote_plan_id(contest, viewer, db)
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
    # The people who can vote. Readers can't, so they aren't counted toward
    # the tally or the majority. Companions can, and are.
    #
    # On a split day a decision belongs to one branch: only the people it's
    # for can vote, so the count and the majority are theirs too.
    voters = select(Contributor).where(
        Contributor.trip_id == contest.trip_id, Contributor.role.in_([r.value for r in VOTING_ROLES])
    )
    if contest.party:
        voters = voters.where(Contributor.id.in_(contest.party))
    contributor_count = len(db.scalars(voters).all())

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
        party=list(contest.party or []),
        plans=plans,
        voted_count=len(contest.votes),
        contributor_count=contributor_count,
        majority_plan_id=majority_plan_id,
        my_vote_plan_id=my_vote_plan_id,
    )


def _capture_into_incumbent(db: Session, contest: Contest, captured: list[Plan]) -> Plan | None:
    """Fold every plan already in the window into a single "on the board"
    option spanning the whole window.

    One option, not one per captured plan, because a contest is settled by
    picking exactly one of its options: if the hours held three plans and
    the group votes to keep things as they are, that has to be one thing to
    vote for. Each captured stop keeps its real clock time via an explicit
    offset_minutes, so a 14:00 dinner inside a 13:00–18:00 window still
    reads 14:00 on the compare screen instead of sliding to the window's
    start.

    Destructive: the captured plans are deleted. If the group keeps the
    board, picking this option puts each captured stop back on the
    calendar as its own plan (pick_set), so a board of three separate
    plans comes back as three — not the originals, but the same stops at
    the same times."""
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
        party=list(contest.party or []),
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
    party: list[int] | None = None,
) -> Contest:
    """The one server path behind both proposal entry points — the tray's
    four-step "Propose a block" flow and DaySchedule's quick tap-an-
    occupied-slot sheet, which is just this with a one-stop window (feature
    spec §6.6).

    Steps follow §6.2: find what's in the window, attach to an
    exactly-matching open contest or refuse a partial overlap, otherwise
    open a contest, capture the incumbents into one option, and add the
    proposal as another.

    `party` is who the decision is for ([] for everyone). On a day the
    group has split, a proposal belongs to one branch: only plans for
    exactly those people are captured, the other branch's plans in the
    same hours are left alone, and only those people vote. A window that
    would sweep in a plan for anyone else — a different branch, or a plan
    for part of this one — is refused, because a single "on the board"
    option can't hold two groups' days at once."""
    if ends_at <= starts_at:
        raise HTTPException(status_code=400, detail="A block has to end after it starts")
    if not items:
        raise HTTPException(status_code=400, detail="A block needs at least one stop")

    ensure_unique_stops(items)
    # Stops now carry their own start times, so "do they fit" is no longer
    # a sum against the window — it is a layout, and it is checked the same
    # way here, on a published draft, and on an edited set.
    validate_stop_layout(db, items, minutes_between(ends_at, starts_at))

    # A locked plan is a fixed hour, not a proposal: the ferry leaves when
    # it leaves. Step 2's drag clips the selection at one rather than
    # crossing it (feature spec §6.5), so reaching here means a race or a
    # client that skipped the clip — either way, refusing is what keeps
    # "everything in the window is in the contest" true.
    party = normalize_party(db, trip_id, party)
    locked = find_overlapping_plans(db, trip_id, starts_at, ends_at, (PlanStatus.locked,), party=party)
    if locked:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Those hours contain a pinned item, so they can't be claimed.",
                "locked_plan_id": locked[0].id,
            },
        )

    overlapping = find_overlapping_plans(db, trip_id, starts_at, ends_at, _CAPTURABLE_STATUSES, party=party)
    for plan in overlapping:
        if list(plan.party or []) != party:
            who = names(db, plan.party) if plan.party else "everyone"
            raise HTTPException(
                status_code=409,
                detail={
                    "message": (
                        f"Those hours hold a plan for {who}. Propose within one group, "
                        "or bring the group back together first."
                    ),
                    "occupying_plan_id": plan.id,
                },
            )

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
            # proposal would mean settling one could invalidate the other.
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
            party=party,
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
        party=list(contest.party or []),
        status=PlanStatus.contested,
        contest_id=contest.id,
        created_by_id=contributor.id if contributor else None,
    )
    db.add(proposal)
    db.flush()
    # Stops keep whatever times the propose screen gave them: NULL where
    # they simply follow the stop before, an explicit offset where free
    # time was asked for in front of them.
    _add_items(db, proposal, items)
    db.flush()
    bus.publish(trip_id, "plan.placed", {"plan_id": proposal.id, "contest_id": contest.id})
    return contest


@router.post("/trips/{trip_id}/contests", response_model=ContestOut, status_code=201)
def propose_block(
    trip_id: int,
    payload: ContestProposeCreate,
    access: Access = Depends(require(PLANS_PROPOSE)),
    db: Session = Depends(get_db),
):
    """Propose an alternative for a range of hours. The proposal claims a
    window rather than targeting one existing plan — see
    open_block_contest above."""
    contest = open_block_contest(
        db,
        trip_id,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        label=payload.label,
        rationale=payload.rationale,
        items=payload.items,
        contributor=access.member,
        party=payload.party,
    )
    db.commit()
    db.refresh(contest)
    return _contest_to_schema(contest, db, access.member)


@router.post("/plans/{plan_id}/publish", response_model=ContestOut, status_code=201)
def publish_plan(
    plan_id: int,
    access: Access = Depends(require(PLANS_PROPOSE)),
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
    viewer = access.member
    if plan.created_by_id != viewer.id:
        # 404, not 403 — a draft belongs to its author alone, and this
        # shouldn't confirm that one exists at that id.
        raise HTTPException(status_code=404, detail="Draft not found")

    items = [
        PlanItemCreate(
            pin_id=item.pin_id,
            travel_item_id=item.travel_item_id,
            duration_minutes=item.duration_minutes,
            offset_minutes=item.offset_minutes,
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
        party=plan.party,
    )
    db.delete(plan)
    db.commit()
    db.refresh(contest)
    bus.publish(trip_id, "plan.published", {"contest_id": contest.id})
    return _contest_to_schema(contest, db, viewer)


@router.get("/contests/{contest_id}", response_model=ContestOut)
def get_contest(contest_id: int, access: Access = Depends(require(PLANS_READ)), db: Session = Depends(get_db)):
    contest = db.get(Contest, contest_id)
    if not contest:
        raise HTTPException(status_code=404, detail="Contest not found")
    return _contest_to_schema(contest, db, access.member)


@router.put("/plans/{plan_id}/stops", response_model=ContestOut)
def update_proposal(
    plan_id: int,
    payload: ProposalUpdate,
    access: Access = Depends(require(PLANS_PROPOSE)),
    db: Session = Depends(get_db),
):
    """Rewrite one candidate plan: its stops, their times, its name and its
    case. The body is the same shape open_block_contest takes, minus the
    window, because editing a set and building one are the same act — the
    propose screen sends this instead of POST /contests when it was opened
    on an option that already exists.

    The window is not editable here and is not in the body. Every option in
    a contest spans exactly the contest's hours; an option that moved them
    would no longer be an answer to the same question, and the hours
    themselves are already claimed against the rest of the calendar.

    Votes cast for this plan are cleared. Someone voting for "ruins first,
    beach after" voted for a list of places in an arrangement of hours;
    silently keeping the tally after either changes would leave their vote
    attached to a plan they never saw."""
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    if plan.status != PlanStatus.contested or plan.contest_id is None:
        # A placed plan is moved with PATCH /api/plans/{id}; a locked one is
        # reopened first. This endpoint is only about options inside a live
        # decision.
        raise HTTPException(status_code=409, detail="Only a candidate plan in an open vote can be edited")
    contest = db.get(Contest, plan.contest_id)
    if contest is None or contest.status != ContestStatus.open:
        raise HTTPException(status_code=409, detail="That decision is already locked")
    if plan.created_by_id is None:
        # The incumbent is not a proposal anyone wrote — it is the board as
        # it stood when the hours were claimed, assembled by the capture in
        # _capture_into_incumbent. Editing it would change the status quo
        # under the people being asked whether to keep it.
        raise HTTPException(
            status_code=409,
            detail={
                "message": "The set already on the board can't be edited. Add a set of your own to suggest something else.",
                "plan_id": plan.id,
            },
        )

    contributor = access.member
    if plan.created_by_id != contributor.id and not contributor.is_owner:
        raise HTTPException(
            status_code=403,
            detail="Only the person who proposed this set, or the trip owner, can edit it",
        )

    ensure_unique_stops(payload.items)
    validate_stop_layout(db, payload.items, minutes_between(plan.ends_at, plan.starts_at))

    plan.label = payload.label
    plan.rationale = payload.rationale
    # Replaced wholesale rather than reconciled: the submitted list is the
    # set, and matching rows up to preserve ids would buy nothing — a
    # PlanItem holds no state of its own beyond what is in the payload, and
    # deleting one never touches the pin behind it.
    dropped = {item.travel_item_id for item in plan.items if item.travel_item_id is not None}
    for item in list(plan.items):
        db.delete(item)
    db.flush()
    _add_items(db, plan, payload.items)
    # A custom event taken out of the set, and used nowhere else, goes
    # rather than lingering in the unplaced list (app/custom_events.py).
    forgotten = forget_orphaned_travel_items(db, dropped)

    stale = db.scalars(select(Vote).where(Vote.contest_id == contest.id, Vote.plan_id == plan.id)).all()
    for vote in stale:
        db.delete(vote)

    db.commit()
    db.refresh(contest)
    bus.publish(
        plan.trip_id,
        "plan.revised",
        {"plan_id": plan.id, "contest_id": contest.id, "votes_cleared": len(stale)},
    )
    publish_forgotten(forgotten)
    return _contest_to_schema(contest, db, contributor)


@router.post("/contests/{contest_id}/vote", response_model=ContestOut)
def toggle_vote(
    contest_id: int,
    payload: VoteToggle,
    access: Access = Depends(require(VOTES_WRITE)),
    db: Session = Depends(get_db),
):
    """One vote per contributor per contest, toggleable — voting for the
    plan you already voted for clears it; voting for a different plan in
    the contest replaces it (see spec "Voting")."""
    contest = db.get(Contest, contest_id)
    if not contest:
        raise HTTPException(status_code=404, detail="Contest not found")
    contributor = access.member
    if contest.party and contributor.id not in contest.party:
        raise HTTPException(
            status_code=403,
            detail={"message": f"This vote is for {names(db, contest.party)}.", "missing_scope": "party"},
        )

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
    return _contest_to_schema(contest, db, contributor)


@router.post("/contests/{contest_id}/pick", response_model=ContestPicked)
def pick_set(
    contest_id: int,
    payload: PickRequest,
    _: Access = Depends(require(PLANS_DECIDE)),
    db: Session = Depends(get_db),
):
    """Owner-only. Settles the decision by putting the chosen set on the
    calendar — not as one locked block spanning the whole window, but as
    one ordinary `placed` plan per stop, at the time that stop had in the
    set. Each can then be moved, resized or removed like anything else on
    the calendar. A majority in the tally is advisory; this is still what
    settles the contest.

    Everything else about the decision goes: every option (the chosen one
    included, now that its stops have their own plans), the votes, and the
    contest row itself. Pins from the other sets become unplaced again;
    custom events only the other sets used are deleted (app/custom_events.py).

    No overlap check is needed: the contest owned its window outright, and
    every stop in a set lies inside that window (validate_stop_layout)."""
    from .plans import plan_to_schema  # local import, same as reopen_plan

    contest = db.get(Contest, contest_id)
    if not contest:
        raise HTTPException(status_code=404, detail="Contest not found")
    if contest.status != ContestStatus.open:
        raise HTTPException(status_code=409, detail="That decision is already settled")
    chosen = db.get(Plan, payload.plan_id)
    if not chosen or chosen.contest_id != contest_id:
        raise HTTPException(status_code=404, detail="That plan is not part of this contest")

    trip_id = contest.trip_id
    orphan_candidates = travel_item_ids_of(contest.plans)

    placed: list[Plan] = []
    for item in sorted(chosen.items, key=lambda i: i.position):
        start = item_start_minutes(chosen, item)
        duration = item_duration_minutes(item)
        plan = Plan(
            trip_id=trip_id,
            starts_at=chosen.starts_at + timedelta(minutes=start),
            ends_at=chosen.starts_at + timedelta(minutes=start + duration),
            color=chosen.color,
            party=list(contest.party or []),
            status=PlanStatus.placed,
            created_by_id=chosen.created_by_id,
        )
        db.add(plan)
        db.flush()
        db.add(
            PlanItem(
                plan_id=plan.id,
                pin_id=item.pin_id,
                travel_item_id=item.travel_item_id,
                position=0,
                # A trim made in the set stays a trim; an untrimmed stop keeps
                # tracking its pin's own duration, as it did in the set.
                duration_minutes=item.duration_minutes,
            )
        )
        placed.append(plan)

    contest.winning_plan_id = None
    db.flush()
    db.delete(contest)  # cascades to its plans, their items, and the votes
    forgotten = forget_orphaned_travel_items(db, orphan_candidates)
    db.commit()

    bus.publish(trip_id, "contest.resolved", {"contest_id": contest_id, "plan_ids": [p.id for p in placed]})
    publish_forgotten(forgotten)
    for plan in placed:
        db.refresh(plan)
    return ContestPicked(placed_plans=[plan_to_schema(plan) for plan in placed])


@router.post("/plans/{plan_id}/reopen", response_model=PlanOut)
def reopen_plan(
    plan_id: int,
    _: Access = Depends(require(PLANS_DECIDE)),
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
    # A locked plan's hours are inert, so nothing stopped someone placing
    # something in them once it was locked... except that locking is what
    # made them inert in the first place. Unlocking into hours that have
    # since been filled would create a silent overlap the calendar has no
    # way to draw, so refuse and name what's in the way instead (feature
    # spec §11).
    occupying = find_overlapping_plan(db, plan.trip_id, plan.starts_at, plan.ends_at, exclude_plan_id=plan.id, party=plan.party)
    if occupying is not None:
        raise HTTPException(status_code=409, detail=occupied_detail(occupying, db, plan.party))

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
