"""The trip's traveler roster: who is going (app/models.py Traveler).

Travelers are separate from members. A member is someone on the app, with
a role; a traveler is someone the plan is for and the costs are split
between. Most members are travelers (joining makes you one unless you say
you're not going), but a child or a grandparent can be listed without ever
signing in, and a planner can help without going.

- Anyone on the trip can see the roster.
- Planners and the owner (travelers:manage) add, edit and remove anyone.
- Anyone can rename their own traveler and say who pays for them.
- The owner can make an invite link for one listed traveler, so whoever
  accepts it becomes that traveler instead of a second copy of them.

Removing a traveler takes them off every group and cost split
(remove_traveler); removing a *member* only unlinks their traveler, since
they're still going even if they've left the app (routers/sharing.py).
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ..custom_events import forget_orphaned_travel_items, publish_forgotten
from ..db import get_db
from ..events import bus
from ..models import Contributor, Pin, TravelItem, Traveler, TripInvite
from ..splits import add_newcomer, remove_from_splits
from ..permissions import MEMBERS_MANAGE, TRAVELERS_MANAGE, TRIP_READ, Access, require
from ..schemas import InviteOut, TravelerBrief, TravelerCreate, TravelerInviteCreate, TravelerOut, TravelerUpdate

router = APIRouter(prefix="/api", tags=["travelers"])

TINTS = ("var(--who-1)", "var(--who-2)", "var(--who-3)", "var(--who-4)")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def initial_for(name: str) -> str:
    return (name.strip()[:1] or "?").upper()


def _pending_invite_ids(db: Session, trip_id: int) -> set[int]:
    return set(
        db.scalars(
            select(TripInvite.traveler_id).where(
                TripInvite.trip_id == trip_id, TripInvite.traveler_id.is_not(None), TripInvite.revoked_at.is_(None)
            )
        ).all()
    )


def traveler_out(traveler: Traveler, pending: set[int] | None = None) -> TravelerOut:
    out = TravelerOut.model_validate(traveler)
    out.invited = traveler.contributor_id is None and traveler.id in (pending or set())
    return out


def traveler_brief(db: Session, traveler: Traveler) -> TravelerBrief:
    payer = db.get(Traveler, traveler.paid_by_id) if traveler.paid_by_id else None
    return TravelerBrief(
        id=traveler.id, name=traveler.name, initial=traveler.initial, tint=traveler.tint,
        paid_by_name=payer.name if payer else None,
    )


def add_traveler(db: Session, trip_id: int, name: str, contributor_id: int | None = None, tint: str | None = None) -> Traveler:
    """A new traveler at the end of the roster — and, where the group has
    split up, in whichever group takes newcomers (app/splits.py)."""
    count = db.scalar(select(func.count()).select_from(Traveler).where(Traveler.trip_id == trip_id)) or 0
    last = db.scalar(select(func.max(Traveler.position)).where(Traveler.trip_id == trip_id))
    traveler = Traveler(
        trip_id=trip_id,
        name=name.strip(),
        initial=initial_for(name),
        tint=tint or TINTS[count % len(TINTS)],
        contributor_id=contributor_id,
        position=(last + 1) if last is not None else 0,
    )
    db.add(traveler)
    db.flush()
    add_newcomer(db, trip_id, traveler.id)
    return traveler


def traveler_for_member(db: Session, trip_id: int, member_id: int) -> Traveler | None:
    return db.scalar(select(Traveler).where(Traveler.trip_id == trip_id, Traveler.contributor_id == member_id))


def _check_payer(db: Session, traveler: Traveler, payer_id: int | None) -> int | None:
    """Who pays for `traveler`, validated. One level only: a traveler
    paid for by someone else can't pay for others, and someone paying for
    others can't be paid for — so "what I'm paying" is always me plus the
    people pointing straight at me, never a chain."""
    if payer_id is None or payer_id == traveler.id:
        return None
    payer = db.get(Traveler, payer_id)
    if payer is None or payer.trip_id != traveler.trip_id:
        raise HTTPException(status_code=400, detail="Whoever pays has to be a traveler on this trip")
    if payer.paid_by_id is not None:
        raise HTTPException(status_code=400, detail=f"{payer.name}'s own costs are paid by someone else, so they can't pay for others")
    covers = db.scalar(select(func.count()).select_from(Traveler).where(Traveler.paid_by_id == traveler.id)) or 0
    if covers:
        raise HTTPException(status_code=400, detail=f"{traveler.name} pays for other travelers, so their own costs can't be paid by someone else")
    return payer.id


def _check_link(db: Session, traveler: Traveler, contributor_id: int | None) -> int | None:
    if contributor_id is None:
        return None
    member = db.get(Contributor, contributor_id)
    if member is None or member.trip_id != traveler.trip_id:
        raise HTTPException(status_code=400, detail="That person isn't a member of this trip")
    other = traveler_for_member(db, traveler.trip_id, contributor_id)
    if other is not None and other.id != traveler.id:
        raise HTTPException(status_code=409, detail=f"{member.display_name} is already listed as {other.name}")
    return contributor_id


def remove_traveler(db: Session, traveler: Traveler) -> set[int]:
    """Take someone off the trip's roster, and so off every group and cost
    split. A group nobody is left in goes with its plans, and a split left
    with one group becomes plans for everyone (app/splits.py). Anyone they
    were paying for pays for themselves again. Returns travel item ids that
    may now be orphaned, for the caller's custom-event cleanup."""
    trip_id = traveler.trip_id
    tid = traveler.id

    for model in (Pin, TravelItem):
        for row in db.scalars(select(model).where(model.trip_id == trip_id)).all():
            if row.heads and tid in row.heads:
                row.heads = [h for h in row.heads if h != tid]

    orphan_candidates = remove_from_splits(db, trip_id, tid)

    db.execute(update(Traveler).where(Traveler.paid_by_id == tid).values(paid_by_id=None))
    db.execute(delete(TripInvite).where(TripInvite.traveler_id == tid))
    db.delete(traveler)
    db.flush()
    return orphan_candidates


@router.get("/trips/{trip_id}/travelers", response_model=list[TravelerOut])
def list_travelers(trip_id: int, _: Access = Depends(require(TRIP_READ)), db: Session = Depends(get_db)):
    pending = _pending_invite_ids(db, trip_id)
    rows = db.scalars(select(Traveler).where(Traveler.trip_id == trip_id).order_by(Traveler.position, Traveler.id)).all()
    return [traveler_out(t, pending) for t in rows]


@router.post("/trips/{trip_id}/travelers", response_model=TravelerOut, status_code=201)
def create_traveler(
    trip_id: int,
    payload: TravelerCreate,
    _: Access = Depends(require(TRAVELERS_MANAGE)),
    db: Session = Depends(get_db),
):
    tint = None
    if payload.contributor_id is not None:
        member = db.get(Contributor, payload.contributor_id)
        tint = member.tint if member is not None and member.trip_id == trip_id else None
    traveler = add_traveler(db, trip_id, payload.name, tint=tint)
    traveler.contributor_id = _check_link(db, traveler, payload.contributor_id)
    traveler.paid_by_id = _check_payer(db, traveler, payload.paid_by_id)
    db.commit()
    db.refresh(traveler)
    bus.publish(trip_id, "traveler.added", {"traveler_id": traveler.id})
    return traveler_out(traveler)


@router.patch("/travelers/{traveler_id}", response_model=TravelerOut)
def update_traveler(
    traveler_id: int,
    payload: TravelerUpdate,
    access: Access = Depends(require(TRIP_READ)),
    db: Session = Depends(get_db),
):
    """Planners edit anyone; everyone can rename themselves and say who
    pays for them. Linking a traveler to a member is a planner's call."""
    traveler = db.get(Traveler, traveler_id)
    fields = payload.model_dump(exclude_unset=True)
    mine = traveler.contributor_id is not None and traveler.contributor_id == access.member.id
    if not access.has(TRAVELERS_MANAGE) and not (mine and set(fields) <= {"name", "paid_by_id"}):
        raise HTTPException(
            status_code=403,
            detail={"message": "You can only change your own name and who pays for you", "missing_scope": TRAVELERS_MANAGE},
        )
    if "name" in fields and fields["name"]:
        traveler.name = fields["name"].strip()
        traveler.initial = initial_for(traveler.name)
    if "contributor_id" in fields:
        traveler.contributor_id = _check_link(db, traveler, fields["contributor_id"])
    if "paid_by_id" in fields:
        traveler.paid_by_id = _check_payer(db, traveler, fields["paid_by_id"])
    db.commit()
    db.refresh(traveler)
    bus.publish(traveler.trip_id, "traveler.updated", {"traveler_id": traveler.id})
    return traveler_out(traveler, _pending_invite_ids(db, traveler.trip_id))


@router.delete("/travelers/{traveler_id}", status_code=204)
def delete_traveler(
    traveler_id: int,
    _: Access = Depends(require(TRAVELERS_MANAGE)),
    db: Session = Depends(get_db),
):
    traveler = db.get(Traveler, traveler_id)
    trip_id = traveler.trip_id
    orphans = remove_traveler(db, traveler)
    forgotten = forget_orphaned_travel_items(db, orphans)
    db.commit()
    bus.publish(trip_id, "traveler.removed", {"traveler_id": traveler_id})
    publish_forgotten(forgotten)
    return None


@router.post("/travelers/{traveler_id}/invite", response_model=InviteOut)
def invite_traveler(
    traveler_id: int,
    payload: TravelerInviteCreate,
    access: Access = Depends(require(MEMBERS_MANAGE)),
    db: Session = Depends(get_db),
):
    """A link for one listed traveler: whoever accepts it signs in as them.
    Reused while it's live; it stops working once the traveler is claimed."""
    traveler = db.get(Traveler, traveler_id)
    if traveler.contributor_id is not None:
        raise HTTPException(status_code=409, detail=f"{traveler.name} is already on the app")
    existing = db.scalar(
        select(TripInvite).where(TripInvite.traveler_id == traveler.id, TripInvite.revoked_at.is_(None))
    )
    if existing is not None and existing.role != payload.role:
        existing.revoked_at = _now()
        existing = None
    if existing is None:
        existing = TripInvite(
            trip_id=traveler.trip_id,
            token=secrets.token_urlsafe(18),
            role=payload.role,
            created_by_id=access.member.id,
            traveler_id=traveler.id,
        )
        db.add(existing)
    db.commit()
    db.refresh(existing)
    return InviteOut(
        id=existing.id,
        role=existing.role,
        token=existing.token,
        created_at=existing.created_at,
        created_by_id=existing.created_by_id,
        joined_count=0,
        traveler_id=traveler.id,
    )
