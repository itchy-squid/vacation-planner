"""Who is on a trip, and how people get on it.

- Members: list (anyone on the trip), change a role or remove someone
  (owner), leave (anyone but the owner).
- Invite links: one live link per role, reused until the owner revokes it.
  Anyone signed in who holds a live link can preview the trip and join it
  with that link's role.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ..auth import Principal, get_current_principal
from ..custom_events import forget_orphaned_travel_items, publish_forgotten, travel_item_ids_of
from ..db import get_db
from ..events import bus
from ..models import (
    AvailabilityOverride,
    Comment,
    Contributor,
    Pin,
    Plan,
    PlanStatus,
    Split,
    TravelItem,
    Traveler,
    Trip,
    TripInvite,
    Vote,
)
from ..permissions import MEMBERS_MANAGE, TRIP_READ, VOTING_ROLES, Access, Role, invite_by_token, member_for, require
from ..schemas import (
    ContributorOut,
    ContributorRoleUpdate,
    InviteAccept,
    InviteCreate,
    InviteOut,
    InvitePreviewOut,
    TripOut,
)
from .travelers import add_traveler, traveler_brief, traveler_for_member
from .trips import member_count, owner_of, owner_out, trip_out

router = APIRouter(prefix="/api", tags=["sharing"])

_TINTS = ("var(--who-1)", "var(--who-2)", "var(--who-3)", "var(--who-4)")


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --- members ------------------------------------------------------------------


@router.get("/trips/{trip_id}/contributors", response_model=list[ContributorOut])
def list_contributors(trip_id: int, _: Access = Depends(require(TRIP_READ)), db: Session = Depends(get_db)):
    return db.scalars(
        select(Contributor).where(Contributor.trip_id == trip_id).order_by(Contributor.joined_at, Contributor.id)
    ).all()


def _member_on_trip(db: Session, trip_id: int, contributor_id: int) -> Contributor:
    member = db.get(Contributor, contributor_id)
    if member is None or member.trip_id != trip_id:
        raise HTTPException(status_code=404, detail="That person isn't on this trip")
    return member


@router.patch("/trips/{trip_id}/contributors/{contributor_id}", response_model=ContributorOut)
def change_role(
    trip_id: int,
    contributor_id: int,
    payload: ContributorRoleUpdate,
    _: Access = Depends(require(MEMBERS_MANAGE)),
    db: Session = Depends(get_db),
):
    member = _member_on_trip(db, trip_id, contributor_id)
    if member.is_owner:
        raise HTTPException(status_code=409, detail="The trip owner's role can't be changed")
    if member.role != payload.role:
        member.role = payload.role
        if Role(payload.role) not in VOTING_ROLES:
            # Readers don't vote. A vote left behind would keep counting
            # toward a tally its caster can no longer change.
            db.execute(delete(Vote).where(Vote.contributor_id == member.id))
        db.commit()
        db.refresh(member)
        bus.publish(trip_id, "member.updated", {"contributor_id": member.id, "role": member.role})
    return member


def _remove_member(db: Session, member: Contributor) -> list[tuple[int, int]]:
    """Take someone off a trip, keeping what they added.

    Pins, travel items, placed plans and proposals stay, unattributed.
    Their private drafts go (nobody else can see them to keep them), as do
    their votes and comments, which only mean anything as theirs. Their id
    stays on the roster as a traveler without an account."""
    trip_id = member.trip_id
    member_id = member.id

    drafts = db.scalars(
        select(Plan).where(Plan.trip_id == trip_id, Plan.created_by_id == member_id, Plan.status == PlanStatus.draft)
    ).all()
    orphan_candidates = travel_item_ids_of(drafts)
    for plan in drafts:
        db.delete(plan)

    db.execute(delete(Vote).where(Vote.contributor_id == member_id))
    db.execute(delete(Comment).where(Comment.contributor_id == member_id))
    db.execute(update(Plan).where(Plan.created_by_id == member_id).values(created_by_id=None))
    db.execute(update(Pin).where(Pin.added_by_id == member_id).values(added_by_id=None))
    db.execute(update(TravelItem).where(TravelItem.added_by_id == member_id).values(added_by_id=None))
    db.execute(
        update(AvailabilityOverride).where(AvailabilityOverride.created_by_id == member_id).values(created_by_id=None)
    )
    db.execute(update(TripInvite).where(TripInvite.created_by_id == member_id).values(created_by_id=None))
    db.execute(update(Split).where(Split.created_by_id == member_id).values(created_by_id=None))

    # They're still going even though they've left the app: their
    # traveler stays on every group and cost split, just without an
    # account behind it (routers/travelers.py). Removing the *traveler* is
    # a separate, deliberate act on the roster.
    db.execute(update(Traveler).where(Traveler.contributor_id == member_id).values(contributor_id=None))

    db.delete(member)
    return forget_orphaned_travel_items(db, orphan_candidates)


@router.delete("/trips/{trip_id}/contributors/{contributor_id}", status_code=204)
def remove_contributor(
    trip_id: int,
    contributor_id: int,
    _: Access = Depends(require(MEMBERS_MANAGE)),
    db: Session = Depends(get_db),
):
    member = _member_on_trip(db, trip_id, contributor_id)
    if member.is_owner:
        raise HTTPException(status_code=409, detail="The trip owner can't be removed")
    forgotten = _remove_member(db, member)
    db.commit()
    bus.publish(trip_id, "member.removed", {"contributor_id": contributor_id})
    publish_forgotten(forgotten)
    return None


@router.post("/trips/{trip_id}/leave", status_code=204)
def leave_trip(trip_id: int, access: Access = Depends(require(TRIP_READ)), db: Session = Depends(get_db)):
    member = access.member
    if member.is_owner:
        raise HTTPException(status_code=409, detail="The trip owner can't leave their own trip")
    member_id = member.id
    forgotten = _remove_member(db, member)
    db.commit()
    bus.publish(trip_id, "member.removed", {"contributor_id": member_id})
    publish_forgotten(forgotten)
    return None


# --- invite links ---------------------------------------------------------------


def _joined_counts(db: Session, invite_ids: list[int]) -> dict[int, int]:
    if not invite_ids:
        return {}
    rows = db.execute(
        select(Contributor.joined_via_invite_id, func.count())
        .where(Contributor.joined_via_invite_id.in_(invite_ids))
        .group_by(Contributor.joined_via_invite_id)
    ).all()
    return dict(rows)


def _invite_out(invite: TripInvite, joined: int) -> InviteOut:
    return InviteOut(
        id=invite.id,
        role=invite.role,
        token=invite.token,
        created_at=invite.created_at,
        created_by_id=invite.created_by_id,
        joined_count=joined,
        traveler_id=invite.traveler_id,
    )


def _live_invites(db: Session, trip_id: int) -> list[TripInvite]:
    return db.scalars(
        select(TripInvite)
        .where(TripInvite.trip_id == trip_id, TripInvite.revoked_at.is_(None), TripInvite.traveler_id.is_(None))
        .order_by(TripInvite.created_at, TripInvite.id)
    ).all()


@router.get("/trips/{trip_id}/invites", response_model=list[InviteOut])
def list_invites(trip_id: int, _: Access = Depends(require(MEMBERS_MANAGE)), db: Session = Depends(get_db)):
    invites = _live_invites(db, trip_id)
    counts = _joined_counts(db, [i.id for i in invites])
    return [_invite_out(i, counts.get(i.id, 0)) for i in invites]


@router.post("/trips/{trip_id}/invites", response_model=InviteOut)
def get_or_create_invite(
    trip_id: int,
    payload: InviteCreate,
    access: Access = Depends(require(MEMBERS_MANAGE)),
    db: Session = Depends(get_db),
):
    """The live link for `role`, made on first ask. Reusing it means the
    owner's list stays one row per role however many times they tap
    Share."""
    existing = next((i for i in _live_invites(db, trip_id) if i.role == payload.role), None)
    if existing is not None:
        return _invite_out(existing, _joined_counts(db, [existing.id]).get(existing.id, 0))

    invite = TripInvite(
        trip_id=trip_id,
        token=secrets.token_urlsafe(18),
        role=payload.role,
        created_by_id=access.member.id,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return _invite_out(invite, 0)


@router.delete("/trips/{trip_id}/invites/{invite_id}", status_code=204)
def revoke_invite(
    trip_id: int,
    invite_id: int,
    _: Access = Depends(require(MEMBERS_MANAGE)),
    db: Session = Depends(get_db),
):
    """Stops the link working. People who already joined through it stay."""
    invite = db.get(TripInvite, invite_id)
    if invite is None or invite.trip_id != trip_id:
        raise HTTPException(status_code=404, detail="Invite link not found")
    if invite.revoked_at is None:
        invite.revoked_at = _now()
        db.commit()
    return None


@router.get("/invites/{token}", response_model=InvitePreviewOut)
def preview_invite(
    token: str,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    invite = invite_by_token(db, token)
    trip = db.get(Trip, invite.trip_id)
    existing = member_for(db, trip.id, principal.email)
    return InvitePreviewOut(
        trip_id=trip.id,
        trip_name=trip.name,
        region_line=trip.region_line,
        start_date=trip.start_date,
        end_date=trip.end_date,
        phase=trip.phase.value,
        role=invite.role,
        owner=owner_out(owner_of(db, trip.id)),
        member_count=member_count(db, trip.id),
        already_member=existing is not None,
        my_role=existing.role if existing else None,
        invite_traveler=_invite_traveler(db, invite),
        unclaimed_travelers=[
            traveler_brief(db, t)
            for t in db.scalars(
                select(Traveler)
                .where(Traveler.trip_id == trip.id, Traveler.contributor_id.is_(None))
                .order_by(Traveler.position, Traveler.id)
            ).all()
        ],
    )


def _invite_traveler(db: Session, invite: TripInvite):
    """The traveler a link was made for, while they're still unclaimed."""
    if invite.traveler_id is None:
        return None
    traveler = db.get(Traveler, invite.traveler_id)
    if traveler is None or traveler.contributor_id is not None:
        return None
    return traveler_brief(db, traveler)


@router.post("/invites/{token}/accept", response_model=TripOut)
def accept_invite(
    token: str,
    payload: InviteAccept | None = None,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    """Add the trip to the caller's list with the link's role. Someone
    already on the trip keeps the role they have — a reader link can't
    demote a contributor, and a contributor link passed around can't be
    used to upgrade a reader the owner chose to keep read-only."""
    invite = invite_by_token(db, token)
    trip = db.get(Trip, invite.trip_id)
    member = member_for(db, trip.id, principal.email)
    if member is None:
        count = member_count(db, trip.id)
        member = Contributor(
            trip_id=trip.id,
            email=principal.email,
            display_name=principal.display_name,
            initial=(principal.display_name[:1] or "?").upper(),
            tint=_TINTS[count % len(_TINTS)],
            role=invite.role,
            joined_via_invite_id=invite.id,
        )
        db.add(member)
        db.flush()
        _claim_traveler(db, trip.id, invite, member, payload or InviteAccept())
        db.commit()
        db.refresh(member)
        bus.publish(trip.id, "member.joined", {"contributor_id": member.id, "role": member.role})
    return trip_out(db, trip, member)


def _claim_traveler(db: Session, trip_id: int, invite: TripInvite, member: Contributor, payload: InviteAccept) -> None:
    """Which traveler a newly joined member is.

    - A link made for one listed traveler claims them, and stops working.
    - Otherwise the person picked a listed traveler on the join screen
      ("are you one of these?"), said they're not going, or neither — in
      which case they're added to the roster as themselves.

    A traveler someone else has already claimed can't be claimed again;
    racing for the same row is a 409, and the loser can simply try again
    as someone new."""
    target: Traveler | None = None
    if invite.traveler_id is not None:
        candidate = db.get(Traveler, invite.traveler_id)
        if candidate is not None and candidate.contributor_id is None:
            target = candidate
            invite.revoked_at = _now()
    elif payload.traveler_id is not None:
        candidate = db.get(Traveler, payload.traveler_id)
        if candidate is None or candidate.trip_id != trip_id:
            raise HTTPException(status_code=404, detail="That traveler isn't on this trip")
        if candidate.contributor_id is not None:
            raise HTTPException(status_code=409, detail=f"{candidate.name} has already joined. Pick someone else, or join as yourself.")
        target = candidate
    if target is not None:
        target.contributor_id = member.id
        member.tint = target.tint
        return
    if payload.not_going or traveler_for_member(db, trip_id, member.id) is not None:
        return
    add_traveler(db, trip_id, member.display_name, contributor_id=member.id, tint=member.tint)
