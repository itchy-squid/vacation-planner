"""The group splitting up for part of a day (models.Split, models.SplitBranch).

Ana and Lin take the Taroko Gorge trail from 08:00 to 11:00 while everyone
else bikes Liyu Lake, then all six meet at the night market. That morning
is one Split with two branches. Each branch holds exactly who is in that
group; each plan and contest in those hours belongs to one branch.

Everything else follows from three rules, and this module is where they are
kept:

1. Splits on a trip never overlap one another.
2. A plan (or contest) in a branch lies inside its split's hours. A plan
   for everyone (branch None) never overlaps a split at all.
3. So two plans collide exactly when their hours overlap and they have the
   same branch — both None included. Nothing has to reason about who is
   on which plan; `branch_id` equality is the whole test, and it runs in
   SQL (routers/plans.py find_overlapping_plan).

The operations that change a split — creating it, changing its hours,
changing who is in which group, someone moving themselves, bringing
everyone back, and travelers joining or leaving the trip — all live here,
so each invariant is enforced in one place rather than re-derived by every
endpoint.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import NoReturn

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .custom_events import travel_item_ids_of
from .models import (
    OCCUPYING_STATUSES,
    Contest,
    ContestStatus,
    Plan,
    PlanStatus,
    Split,
    SplitBranch,
    Traveler,
)
from .tripclock import as_trip_time


# ---- who ----------------------------------------------------------------


def roster_ids(db: Session, trip_id: int) -> set[int]:
    return set(db.scalars(select(Traveler.id).where(Traveler.trip_id == trip_id)).all())


def audience(branch: SplitBranch | None, roster: set[int]) -> set[int]:
    """Who a plan or contest in `branch` is for: that group, or everyone."""
    return set(roster) if branch is None else branch.members(roster)


def traveler_rows(db: Session, ids: Iterable[int]) -> list[Traveler]:
    ids = list(ids)
    if not ids:
        return []
    return list(db.scalars(select(Traveler).where(Traveler.id.in_(ids)).order_by(Traveler.position, Traveler.id)).all())


def join_names(names: Sequence[str]) -> str:
    """"Ana", "Ana and Lin", "Mei, Jae and Theo"."""
    if not names:
        return "nobody"
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + " and " + names[-1]


def names(db: Session, ids: Iterable[int]) -> str:
    """The travelers with these ids, joined, in roster order."""
    return join_names([t.name for t in traveler_rows(db, ids)])


def branch_name(db: Session, branch: SplitBranch) -> str:
    """What to call a group in a sentence: its label, else who is in it."""
    return branch.label or names(db, branch.traveler_ids or ())


def _clock(value: datetime) -> str:
    return as_trip_time(value).strftime("%H:%M")


def _hours(split: Split) -> str:
    return f"{_clock(split.starts_at)}–{_clock(split.ends_at)}"


# ---- where a plan may go ------------------------------------------------


def split_overlapping(db: Session, trip_id: int, starts_at: datetime, ends_at: datetime, exclude_split_id: int | None = None) -> Split | None:
    """A split sharing any minute with these hours. Touching edges don't
    count, the same as for plans."""
    stmt = select(Split).where(Split.trip_id == trip_id, Split.starts_at < ends_at, Split.ends_at > starts_at)
    if exclude_split_id is not None:
        stmt = stmt.where(Split.id != exclude_split_id)
    return db.scalars(stmt.order_by(Split.starts_at)).first()


def resolve_branch(db: Session, trip_id: int, branch_id: int | None, starts_at: datetime, ends_at: datetime) -> SplitBranch | None:
    """The branch a plan or proposal over these hours would be in, checked.

    Rule 2 above, for anything about to claim time: a plan for a group has
    to fit inside that group's split, and a plan for everyone has to stay
    clear of every split. Both refusals are 409s carrying `split_id`, so a
    client can point at the split rather than just say no."""
    if branch_id is None:
        split = split_overlapping(db, trip_id, starts_at, ends_at)
        if split is not None:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": f"The group is split up from {_hours(split)}. Plan those hours for one of the groups, or bring everyone back first.",
                    "split_id": split.id,
                },
            )
        return None

    branch = db.get(SplitBranch, branch_id)
    if branch is None or branch.split.trip_id != trip_id:
        raise HTTPException(status_code=400, detail="That group isn't part of this trip")
    split = branch.split
    if as_trip_time(starts_at) < as_trip_time(split.starts_at) or as_trip_time(ends_at) > as_trip_time(split.ends_at):
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"Plans for {branch_name(db, branch)} have to fit inside the split, {_hours(split)}.",
                "split_id": split.id,
            },
        )
    return branch


# ---- creating and reshaping a split -------------------------------------


@dataclass(frozen=True)
class BranchSpec:
    """One group as a client describes it. `id` names an existing branch
    when reshaping a split; None is a new one."""

    traveler_ids: tuple[int, ...]
    label: str = ""
    takes_newcomers: bool = False
    id: int | None = None


def _validate_specs(db: Session, trip_id: int, specs: Sequence[BranchSpec]) -> None:
    if len(specs) < 2:
        raise HTTPException(status_code=400, detail="A split needs at least two groups.")
    roster = roster_ids(db, trip_id)
    seen: set[int] = set()
    for spec in specs:
        members = set(spec.traveler_ids)
        if not members:
            raise HTTPException(status_code=400, detail="Every group needs someone in it.")
        if members - roster:
            raise HTTPException(status_code=400, detail="Everyone in a group has to be a traveler on the trip.")
        twice = members & seen
        if twice:
            raise HTTPException(status_code=400, detail=f"{names(db, twice)} can't be in two groups at once.")
        seen |= members
    if sum(1 for spec in specs if spec.takes_newcomers) > 1:
        raise HTTPException(status_code=400, detail="Only one group can take the people added to the trip later.")


def create_split(
    db: Session,
    trip_id: int,
    *,
    starts_at: datetime,
    ends_at: datetime,
    branches: Sequence[BranchSpec],
    keep_plans_with: int = 0,
    created_by_id: int | None = None,
) -> Split:
    """Split the group over these hours. Whatever is already on the
    calendar then goes to the branch at index `keep_plans_with` — the
    people who stay on what was planned; the others start with nothing.

    Refused while any of it can't simply change hands: something only
    partly inside the hours, a vote in progress, or a pinned plan (the
    owner pinned it for everyone; handing it to one group is theirs to
    decide by reopening it first)."""
    if as_trip_time(ends_at) <= as_trip_time(starts_at):
        raise HTTPException(status_code=400, detail="A split has to end after it starts.")
    _validate_specs(db, trip_id, branches)
    if not 0 <= keep_plans_with < len(branches):
        raise HTTPException(status_code=400, detail="keep_plans_with has to name one of the groups.")

    clash = split_overlapping(db, trip_id, starts_at, ends_at)
    if clash is not None:
        raise HTTPException(
            status_code=409,
            detail={"message": f"The group is already split up from {_hours(clash)}.", "split_id": clash.id},
        )

    inside = db.scalars(
        select(Plan).where(
            Plan.trip_id == trip_id,
            Plan.branch_id.is_(None),
            Plan.status.in_(OCCUPYING_STATUSES),
            Plan.starts_at < ends_at,
            Plan.ends_at > starts_at,
        )
    ).all()
    for plan in inside:
        if as_trip_time(plan.starts_at) < as_trip_time(starts_at) or as_trip_time(plan.ends_at) > as_trip_time(ends_at):
            raise HTTPException(
                status_code=409,
                detail={
                    "message": f"{plan.title} runs {_clock(plan.starts_at)}–{_clock(plan.ends_at)}, past the hours being split. Split around it, or move it first.",
                    "plan_id": plan.id,
                },
            )
        if plan.status == PlanStatus.contested:
            raise HTTPException(status_code=409, detail="Those hours are out for a vote. Settle it before you split the group.")
        if plan.status == PlanStatus.locked:
            raise HTTPException(
                status_code=409,
                detail=f"{plan.title} is pinned. The trip owner has to reopen it before the group splits over it.",
            )

    split = Split(trip_id=trip_id, starts_at=starts_at, ends_at=ends_at, created_by_id=created_by_id)
    db.add(split)
    rows = [_new_branch(split, spec, position) for position, spec in enumerate(branches)]
    db.flush()
    keeper = rows[keep_plans_with]
    for plan in inside:
        plan.branch_id = keeper.id
    db.flush()
    return split


def _new_branch(split: Split, spec: BranchSpec, position: int) -> SplitBranch:
    branch = SplitBranch(
        label=spec.label.strip(),
        position=position,
        traveler_ids=sorted(set(spec.traveler_ids)),
        takes_newcomers=spec.takes_newcomers,
    )
    split.branches.append(branch)
    return branch


def reshape_split(db: Session, split: Split, branches: Sequence[BranchSpec]) -> Split:
    """Say who is in which group — the whole assignment at once, so moving
    Jae from the lake to the gorge is one change that can't leave him in
    both or neither by accident. Existing branches are named by id; a spec
    without one adds a group. A group left out is removed, which is only
    allowed once nothing is planned for it."""
    _validate_specs(db, split.trip_id, branches)
    by_id = {b.id: b for b in split.branches}
    unknown = {spec.id for spec in branches if spec.id is not None} - set(by_id)
    if unknown:
        raise HTTPException(status_code=400, detail="That group isn't part of this split.")

    kept_ids = {spec.id for spec in branches if spec.id is not None}
    for branch in split.branches:
        if branch.id not in kept_ids and _has_plans(db, branch):
            raise HTTPException(
                status_code=409,
                detail=f"There are still plans for {branch_name(db, branch)}. Clear them, or bring everyone back, before removing that group.",
            )
    for branch in list(split.branches):
        if branch.id not in kept_ids:
            _drop_branch(db, branch)

    for position, spec in enumerate(branches):
        if spec.id is None:
            _new_branch(split, spec, position)
            continue
        branch = by_id[spec.id]
        branch.label = spec.label.strip()
        branch.position = position
        branch.traveler_ids = sorted(set(spec.traveler_ids))
        branch.takes_newcomers = spec.takes_newcomers
    db.flush()
    for branch in split.branches:
        _prune_votes(db, branch)
    return split


def retime_split(db: Session, split: Split, starts_at: datetime, ends_at: datetime) -> Split:
    """Change a split's hours — its edge dragged on the calendar.

    Nothing changes hands, unlike splitting: rules 1 and 2 have to hold
    over the new hours exactly as things are. So the hours still have to
    hold everything planned or out for a vote in each group, and can't
    reach into another split or take in anything for everyone. (A vote's
    proposal spans the vote's whole window, so checking plans covers
    votes too.) Each refusal is a 409 naming what's in the way, with its
    `plan_id` or `split_id`: the fix is to move that thing first, and a
    person needs to know which thing it is."""
    start, end = as_trip_time(starts_at), as_trip_time(ends_at)
    if end <= start:
        raise HTTPException(status_code=400, detail="A split has to end after it starts.")

    clash = split_overlapping(db, split.trip_id, starts_at, ends_at, exclude_split_id=split.id)
    if clash is not None:
        raise HTTPException(
            status_code=409,
            detail={"message": f"The group is already split up from {_hours(clash)}.", "split_id": clash.id},
        )

    for branch in split.branches:
        for plan in _plans_in(db, branch):
            if as_trip_time(plan.starts_at) < start or as_trip_time(plan.ends_at) > end:
                _refuse_retime(plan, f"for {branch_name(db, branch)}", "outside those hours")

    for_everyone = db.scalars(
        select(Plan)
        .where(
            Plan.trip_id == split.trip_id,
            Plan.branch_id.is_(None),
            Plan.status.in_(OCCUPYING_STATUSES),
            Plan.starts_at < ends_at,
            Plan.ends_at > starts_at,
        )
        .order_by(Plan.starts_at)
    ).first()
    if for_everyone is not None:
        _refuse_retime(for_everyone, "for everyone", "inside those hours")

    split.starts_at = starts_at
    split.ends_at = ends_at
    db.flush()
    return split


def _refuse_retime(plan: Plan, whose: str, where: str) -> NoReturn:
    """The 409 for a split's new hours that would leave `plan` on the
    wrong side of its edge."""
    hours = f"{_clock(plan.starts_at)}–{_clock(plan.ends_at)}"
    if plan.status == PlanStatus.contested:
        message = f"There's a vote in progress {whose} from {hours}, {where}. Settle it first."
    else:
        message = f"{plan.title} {whose} runs {hours}, {where}. Move it first."
    raise HTTPException(status_code=409, detail={"message": message, "plan_id": plan.id})


def join_branch(db: Session, branch: SplitBranch, traveler_id: int) -> Split | None:
    """Move one traveler onto `branch` — "I'm going with Ana". They come
    off whichever other group of the same split they were in; nobody else
    moves. If that leaves their old group empty and it has nothing
    planned, the group goes; if only one group is then left, there is no
    split any more and it dissolves (returns None)."""
    split = branch.split
    if traveler_id in (branch.traveler_ids or []):
        return split
    for other in list(split.branches):
        if other.id == branch.id or traveler_id not in (other.traveler_ids or []):
            continue
        remaining = [t for t in other.traveler_ids if t != traveler_id]
        if not remaining:
            if _has_plans(db, other):
                raise HTTPException(
                    status_code=409,
                    detail=f"You're the only one in {branch_name(db, other)}, and it has plans. Clear them, or ask a planner to bring everyone back, before you switch groups.",
                )
            _drop_branch(db, other)
        else:
            other.traveler_ids = remaining
            _prune_votes(db, other)
    branch.traveler_ids = sorted({*branch.traveler_ids, traveler_id})
    db.flush()
    db.refresh(split)
    if len(split.branches) < 2:
        _dissolve(db, split, keep=branch)
        return None
    return split


@dataclass
class MergeResult:
    removed_plan_ids: list[int]
    orphan_candidates: set[int]


def merge_split(db: Session, split: Split, keep: SplitBranch) -> MergeResult:
    """Bring everyone back together: `keep`'s plans become everyone's, and
    every other group's plans come off the calendar (their pins go back to
    the tray; custom events only they used go, like any unplace).

    Refused, naming what's in the way, while another group has a pinned
    plan or a vote in progress — those are decisions someone made, and
    silently throwing them away is not what "bring everyone back" means."""
    if keep.split_id != split.id:
        raise HTTPException(status_code=400, detail="That group isn't part of this split.")
    others = [b for b in split.branches if b.id != keep.id]
    for branch in others:
        for plan in _plans_in(db, branch):
            if plan.status == PlanStatus.locked:
                raise HTTPException(
                    status_code=409,
                    detail=f"{plan.title} is pinned for {branch_name(db, branch)}. The trip owner has to reopen it before everyone comes back together.",
                )
            if plan.status == PlanStatus.contested:
                raise HTTPException(
                    status_code=409,
                    detail=f"There's a vote in progress for {branch_name(db, branch)}. Settle it before everyone comes back together.",
                )

    result = MergeResult(removed_plan_ids=[], orphan_candidates=set())
    for branch in others:
        removed = _plans_in(db, branch)
        result.removed_plan_ids += [p.id for p in removed]
        result.orphan_candidates |= travel_item_ids_of(removed)
        for plan in removed:
            db.delete(plan)
    db.flush()
    _dissolve(db, split, keep=keep)
    return result


# ---- travelers joining and leaving the trip -----------------------------


def add_newcomer(db: Session, trip_id: int, traveler_id: int) -> None:
    """Someone was added to the trip: put them in every group that takes
    newcomers. Splits without one leave them free, like anyone on no
    branch."""
    branches = db.scalars(
        select(SplitBranch).join(Split).where(Split.trip_id == trip_id, SplitBranch.takes_newcomers.is_(True))
    ).all()
    for branch in branches:
        branch.traveler_ids = sorted({*(branch.traveler_ids or []), traveler_id})


def remove_from_splits(db: Session, trip_id: int, traveler_id: int) -> set[int]:
    """Someone is leaving the trip: take them out of every group. A group
    nobody is left in goes, with everything planned for it — a plan for
    nobody is not a plan. A split left with one group dissolves into plans
    for everyone. Returns travel item ids that may now be orphaned."""
    orphans: set[int] = set()
    for split in db.scalars(select(Split).where(Split.trip_id == trip_id)).all():
        for branch in list(split.branches):
            if traveler_id not in (branch.traveler_ids or []):
                continue
            remaining = [t for t in branch.traveler_ids if t != traveler_id]
            if remaining:
                branch.traveler_ids = remaining
                _prune_votes(db, branch)
                continue
            doomed = _plans_in(db, branch)
            orphans |= travel_item_ids_of(doomed)
            for plan in doomed:
                db.delete(plan)
            db.flush()
            _drop_branch(db, branch)
        db.flush()
        db.refresh(split)
        if len(split.branches) < 2:
            _dissolve(db, split, keep=split.branches[0] if split.branches else None)
    return orphans


# ---- internals ------------------------------------------------------------


def _plans_in(db: Session, branch: SplitBranch) -> list[Plan]:
    """Everything a group has on the calendar, votes included — not
    drafts, which are private and simply lose their group."""
    return list(
        db.scalars(select(Plan).where(Plan.branch_id == branch.id, Plan.status != PlanStatus.draft)).all()
    )


def _has_plans(db: Session, branch: SplitBranch) -> bool:
    return bool(_plans_in(db, branch))


def _drop_branch(db: Session, branch: SplitBranch) -> None:
    """Remove a group whose calendar is already empty. Its contests go
    (their options were its plans), and drafts written for it become
    drafts for everyone, which publishing will then check afresh."""
    for contest in db.scalars(select(Contest).where(Contest.branch_id == branch.id)).all():
        db.delete(contest)
    for draft in db.scalars(select(Plan).where(Plan.branch_id == branch.id)).all():
        draft.branch_id = None
    branch.split.branches.remove(branch)
    db.delete(branch)
    db.flush()


def _dissolve(db: Session, split: Split, keep: SplitBranch | None) -> None:
    """End a split whose other groups are gone: `keep`'s plans, drafts and
    votes become the whole trip's. Callers have already cleared every
    other group's plans, so nothing can collide."""
    if keep is not None:
        for plan in db.scalars(select(Plan).where(Plan.branch_id == keep.id)).all():
            plan.branch_id = None
        for contest in db.scalars(select(Contest).where(Contest.branch_id == keep.id)).all():
            contest.branch_id = None
    for branch in split.branches:
        if keep is None or branch.id != keep.id:
            for contest in db.scalars(select(Contest).where(Contest.branch_id == branch.id)).all():
                db.delete(contest)
    db.flush()
    db.delete(split)
    db.flush()


def _prune_votes(db: Session, branch: SplitBranch) -> None:
    """Only a group's own travelers vote on its decisions. When someone
    leaves the group, a vote they cast there goes with them."""
    open_contests = db.scalars(
        select(Contest).where(Contest.branch_id == branch.id, Contest.status == ContestStatus.open)
    ).all()
    if not open_contests:
        return
    allowed = voter_ids(db, branch)
    for contest in open_contests:
        for vote in list(contest.votes):
            if vote.contributor_id not in allowed:
                db.delete(vote)


def voter_ids(db: Session, branch: SplitBranch) -> set[int]:
    """The members who vote on a group's decisions: those linked to a
    traveler in it. Travelers without an account never vote; Kai's say goes
    through whoever asks him."""
    roster = roster_ids(db, branch.split.trip_id)
    members = branch.members(roster)
    if not members:
        return set()
    return set(
        db.scalars(
            select(Traveler.contributor_id).where(Traveler.id.in_(members), Traveler.contributor_id.is_not(None))
        ).all()
    )

