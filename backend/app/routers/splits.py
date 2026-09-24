"""The group splitting up — the HTTP side of app/splits.py.

- GET  /api/trips/{trip_id}/splits      every split on the trip
- POST /api/trips/{trip_id}/splits      split the group over some hours
- PUT  /api/splits/{split_id}           say who is in which group
- PUT  /api/splits/{split_id}/hours     change when the split starts and ends
- POST /api/splits/{split_id}/merge     bring everyone back together
- POST /api/branches/{branch_id}/join   move yourself into a group

Splitting, reshaping, retiming and merging are plans:write — they change what the
calendar says for other people. Joining is plans:join, which companions
have: it only ever moves the caller, as the traveler they are.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..custom_events import forget_orphaned_travel_items, publish_forgotten
from ..db import get_db
from ..events import bus
from ..models import Split, SplitBranch, Traveler
from ..permissions import PLANS_JOIN, PLANS_READ, PLANS_WRITE, Access, require
from ..schemas import SplitBranchIn, SplitCreate, SplitHours, SplitMerge, SplitOut, SplitUpdate
from ..splits import BranchSpec, create_split, join_branch, merge_split, reshape_split, retime_split

router = APIRouter(prefix="/api", tags=["splits"])


def split_to_schema(split: Split) -> SplitOut:
    return SplitOut.model_validate(split, from_attributes=True)


def _specs(branches: list[SplitBranchIn]) -> list[BranchSpec]:
    return [
        BranchSpec(id=b.id, label=b.label, traveler_ids=tuple(b.traveler_ids), takes_newcomers=b.takes_newcomers)
        for b in branches
    ]


def _split_or_404(db: Session, split_id: int) -> Split:
    split = db.get(Split, split_id)
    if split is None:
        raise HTTPException(status_code=404, detail="Split not found")
    return split


@router.get("/trips/{trip_id}/splits", response_model=list[SplitOut])
def list_splits(trip_id: int, _: Access = Depends(require(PLANS_READ)), db: Session = Depends(get_db)):
    rows = db.scalars(select(Split).where(Split.trip_id == trip_id).order_by(Split.starts_at)).all()
    return [split_to_schema(s) for s in rows]


@router.post("/trips/{trip_id}/splits", response_model=SplitOut, status_code=201)
def post_split(
    trip_id: int,
    payload: SplitCreate,
    access: Access = Depends(require(PLANS_WRITE)),
    db: Session = Depends(get_db),
):
    split = create_split(
        db,
        trip_id,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        branches=_specs(payload.branches),
        keep_plans_with=payload.keep_plans_with,
        created_by_id=access.member.id,
    )
    db.commit()
    db.refresh(split)
    bus.publish(trip_id, "split.created", {"split_id": split.id})
    return split_to_schema(split)


@router.put("/splits/{split_id}", response_model=SplitOut)
def put_split(
    split_id: int,
    payload: SplitUpdate,
    _: Access = Depends(require(PLANS_WRITE)),
    db: Session = Depends(get_db),
):
    split = reshape_split(db, _split_or_404(db, split_id), _specs(payload.branches))
    db.commit()
    db.refresh(split)
    bus.publish(split.trip_id, "split.updated", {"split_id": split.id})
    return split_to_schema(split)


@router.put("/splits/{split_id}/hours", response_model=SplitOut)
def put_split_hours(
    split_id: int,
    payload: SplitHours,
    _: Access = Depends(require(PLANS_WRITE)),
    db: Session = Depends(get_db),
):
    split = retime_split(db, _split_or_404(db, split_id), payload.starts_at, payload.ends_at)
    db.commit()
    db.refresh(split)
    bus.publish(split.trip_id, "split.updated", {"split_id": split.id})
    return split_to_schema(split)


@router.post("/splits/{split_id}/merge", status_code=204)
def post_merge(
    split_id: int,
    payload: SplitMerge,
    _: Access = Depends(require(PLANS_WRITE)),
    db: Session = Depends(get_db),
):
    split = _split_or_404(db, split_id)
    keep = db.get(SplitBranch, payload.keep_branch_id)
    if keep is None or keep.split_id != split.id:
        raise HTTPException(status_code=400, detail="That group isn't part of this split.")
    trip_id = split.trip_id
    result = merge_split(db, split, keep)
    forgotten = forget_orphaned_travel_items(db, result.orphan_candidates)
    db.commit()
    for plan_id in result.removed_plan_ids:
        bus.publish(trip_id, "plan.removed", {"plan_id": plan_id})
    bus.publish(trip_id, "split.merged", {"split_id": split_id})
    publish_forgotten(forgotten)
    return None


@router.post("/branches/{branch_id}/join", response_model=SplitOut | None)
def post_join(
    branch_id: int,
    access: Access = Depends(require(PLANS_JOIN)),
    db: Session = Depends(get_db),
):
    """"I'm going with Ana." Moves the caller's own traveler into this
    group and out of any other group of the same split. Returns the split,
    or null if that left only one group and so ended the split."""
    branch = db.get(SplitBranch, branch_id)
    me = db.scalar(select(Traveler).where(Traveler.trip_id == access.trip_id, Traveler.contributor_id == access.member.id))
    if me is None:
        raise HTTPException(status_code=409, detail="You're not listed as a traveler on this trip, so there's no group to move.")
    trip_id = access.trip_id
    split_id = branch.split_id
    split = join_branch(db, branch, me.id)
    db.commit()
    if split is None:
        bus.publish(trip_id, "split.merged", {"split_id": split_id})
        return None
    db.refresh(split)
    bus.publish(trip_id, "split.updated", {"split_id": split.id})
    return split_to_schema(split)
