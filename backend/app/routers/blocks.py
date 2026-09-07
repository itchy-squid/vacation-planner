from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_contributor, get_current_principal, get_principal
from ..db import get_db
from ..derive import candidate_set_totals
from ..events import bus
from ..models import Block, BlockStatus, Contributor, Vote
from ..schemas import BlockOut, CandidateSetOut, CandidateSetStopOut, LockRequest, VoteToggle

router = APIRouter(tags=["blocks"])


def _my_vote_candidate_set_id(block: Block, request: Request | None, db: Session) -> int | None:
    """Best-effort: only set when the request carries an identifiable
    principal (Easy Auth headers in prod, DEV_USER_EMAIL locally) who is
    already a contributor on this trip. Never raises — an anonymous or
    unrecognized caller just sees no vote highlighted."""
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
        select(Contributor).where(Contributor.trip_id == block.trip_id, Contributor.email == principal_email)
    )
    if not contributor:
        return None
    vote = db.scalar(select(Vote).where(Vote.block_id == block.id, Vote.contributor_id == contributor.id))
    return vote.candidate_set_id if vote else None


def _block_to_schema(block: Block, db: Session, request: Request | None = None) -> BlockOut:
    block_minutes = block.end_minute - block.start_minute
    set_payloads: list[CandidateSetOut] = []
    for cs in block.candidate_sets:
        totals = candidate_set_totals(cs, block_minutes)
        set_payloads.append(
            CandidateSetOut(
                id=cs.id,
                key=cs.key,
                label=cs.label,
                color=cs.color,
                is_draft=cs.is_draft,
                stops=[CandidateSetStopOut(pin=s.pin, position=s.position) for s in cs.stops],
                vote_count=len(cs.votes),
                **totals,
            )
        )

    voted_count = len(db.scalars(select(Vote).where(Vote.block_id == block.id)).all())
    contributor_count = len(db.scalars(select(Contributor).where(Contributor.trip_id == block.trip_id)).all())

    return BlockOut(
        id=block.id,
        trip_id=block.trip_id,
        day_index=block.day_index,
        start_minute=block.start_minute,
        end_minute=block.end_minute,
        region=block.region,
        status=block.status.value,
        locked_set_id=block.locked_set_id,
        candidate_sets=set_payloads,
        voted_count=voted_count,
        contributor_count=contributor_count,
        my_vote_candidate_set_id=_my_vote_candidate_set_id(block, request, db),
    )


@router.get("/api/trips/{trip_id}/blocks", response_model=list[BlockOut])
def list_blocks(trip_id: int, request: Request, db: Session = Depends(get_db)):
    blocks = db.scalars(select(Block).where(Block.trip_id == trip_id)).all()
    return [_block_to_schema(b, db, request) for b in blocks]


@router.get("/api/blocks/{block_id}", response_model=BlockOut)
def get_block(block_id: int, request: Request, db: Session = Depends(get_db)):
    block = db.get(Block, block_id)
    if not block:
        raise HTTPException(status_code=404, detail="Block not found")
    return _block_to_schema(block, db, request)


@router.post("/api/blocks/{block_id}/vote", response_model=BlockOut)
def toggle_vote(
    block_id: int,
    payload: VoteToggle,
    request: Request,
    db: Session = Depends(get_db),
):
    """One vote per contributor per block, toggleable — voting for the set
    you already voted for clears it (handoff README "Voting")."""
    block = db.get(Block, block_id)
    if not block:
        raise HTTPException(status_code=404, detail="Block not found")
    contributor = get_current_contributor(trip_id=block.trip_id, principal=get_current_principal(request), db=db)

    existing = db.scalar(
        select(Vote).where(Vote.block_id == block_id, Vote.contributor_id == contributor.id)
    )
    if existing and existing.candidate_set_id == payload.candidate_set_id:
        db.delete(existing)
    else:
        if existing:
            db.delete(existing)
            db.flush()
        db.add(Vote(block_id=block_id, candidate_set_id=payload.candidate_set_id, contributor_id=contributor.id))
    db.commit()
    bus.publish(block.trip_id, "vote.changed", {"block_id": block_id})
    db.refresh(block)
    return _block_to_schema(block, db, request)


@router.post("/api/blocks/{block_id}/lock", response_model=BlockOut)
def lock_block(
    block_id: int,
    payload: LockRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Only the trip owner may lock (handoff README "Locking"). Contributor
    identity comes from Easy Auth in production, or DEV_USER_EMAIL locally
    — see app/auth.py."""
    block = db.get(Block, block_id)
    if not block:
        raise HTTPException(status_code=404, detail="Block not found")
    contributor = get_current_contributor(trip_id=block.trip_id, principal=get_current_principal(request), db=db)
    if not contributor.is_owner:
        raise HTTPException(status_code=403, detail="Only the trip owner can lock a block")

    block.locked_set_id = payload.candidate_set_id
    block.status = BlockStatus.locked
    db.commit()
    bus.publish(block.trip_id, "block.locked", {"block_id": block_id, "candidate_set_id": payload.candidate_set_id})
    db.refresh(block)
    return _block_to_schema(block, db, request)


@router.post("/api/blocks/{block_id}/reopen", response_model=BlockOut)
def reopen_block(block_id: int, request: Request, db: Session = Depends(get_db)):
    block = db.get(Block, block_id)
    if not block:
        raise HTTPException(status_code=404, detail="Block not found")
    contributor = get_current_contributor(trip_id=block.trip_id, principal=get_current_principal(request), db=db)
    if not contributor.is_owner:
        raise HTTPException(status_code=403, detail="Only the trip owner can reopen a locked block")

    block.locked_set_id = None
    block.status = BlockStatus.contested
    db.commit()
    bus.publish(block.trip_id, "block.reopened", {"block_id": block_id})
    db.refresh(block)
    return _block_to_schema(block, db, request)
