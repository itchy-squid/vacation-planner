"""Deleting your own account: the self-serve deletion the privacy policy
(frontend/src/pages/public/PrivacyPolicy.jsx) offers.

There is no user table. A person is their Contributor rows, one per trip,
matched by email (app/permissions.py member_for), so deleting an account
means leaving every trip at once:

- A trip you're on but don't own: you leave it exactly as POST
  /trips/{id}/leave does (sharing._remove_member). Places, travel items
  and plans you added stay for the group, unattributed; your votes,
  comments, private drafts and cost-split shares go.
- A trip you own that has other people on it: ownership passes to the
  next member in line (see _successor), then you leave it the same way.
- A trip you own alone: deleted outright, with its mirrored photos.

GET /api/me/deletion-preview sorts your trips into those three groups so
the confirmation screen can name them. Nothing is kept afterwards to
recognise you: signing in again starts over with no trips.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from .. import photo_storage
from ..auth import Principal, get_current_principal
from ..custom_events import publish_forgotten
from ..db import get_db
from ..events import bus
from ..models import (
    AvailabilityOverride,
    AvailabilityRule,
    Comment,
    Contest,
    Contributor,
    Pin,
    Plan,
    PlanItem,
    TravelItem,
    Trip,
    TripInvite,
    Vote,
)
from ..schemas import AccountDeletionPreviewOut, DeletionTripOut
from .sharing import _remove_member

router = APIRouter(prefix="/api", tags=["account"])

# Who takes over a trip when its owner deletes their account: whoever can
# already do the most (a planner, then a companion, then a reader), and
# among those whoever has been on the trip longest.
_SUCCESSION_ORDER = {"planner": 0, "companion": 1, "reader": 2}

_NO_SYNC = {"synchronize_session": False}


def _successor(db: Session, owner: Contributor) -> Contributor | None:
    others = db.scalars(
        select(Contributor).where(Contributor.trip_id == owner.trip_id, Contributor.id != owner.id)
    ).all()
    if not others:
        return None
    return min(others, key=lambda c: (_SUCCESSION_ORDER.get(c.role, len(_SUCCESSION_ORDER)), c.joined_at, c.id))


def _memberships(db: Session, email: str) -> list[tuple[Contributor, Trip, Contributor | None]]:
    """(membership, its trip, the new owner if it's a trip being handed
    over), oldest trip first."""
    rows = db.execute(
        select(Contributor, Trip)
        .join(Trip, Trip.id == Contributor.trip_id)
        .where(Contributor.email == email)
        .order_by(Trip.created_at, Trip.id)
    ).all()
    return [(member, trip, _successor(db, member) if member.is_owner else None) for member, trip in rows]


def _delete_trip(db: Session, trip_id: int) -> None:
    """Delete a trip and everything in it. Spelled out table by table
    rather than left to ON DELETE CASCADE, so it doesn't depend on the
    database enforcing foreign keys (the tests' SQLite doesn't), and so the
    two circular references (a contest's winning plan, a plan's contest)
    are broken before either side goes."""
    pin_ids = select(Pin.id).where(Pin.trip_id == trip_id)
    plan_ids = select(Plan.id).where(Plan.trip_id == trip_id)
    contest_ids = select(Contest.id).where(Contest.trip_id == trip_id)

    statements = [
        delete(Vote).where(Vote.contest_id.in_(contest_ids)),
        delete(Comment).where(or_(Comment.pin_id.in_(pin_ids), Comment.plan_id.in_(plan_ids))),
        delete(PlanItem).where(PlanItem.plan_id.in_(plan_ids)),
        delete(AvailabilityOverride).where(AvailabilityOverride.pin_id.in_(pin_ids)),
        delete(AvailabilityRule).where(AvailabilityRule.pin_id.in_(pin_ids)),
        update(Contest).where(Contest.trip_id == trip_id).values(winning_plan_id=None),
        update(Plan).where(Plan.trip_id == trip_id).values(contest_id=None),
        delete(Plan).where(Plan.trip_id == trip_id),
        delete(Contest).where(Contest.trip_id == trip_id),
        delete(Pin).where(Pin.trip_id == trip_id),
        delete(TravelItem).where(TravelItem.trip_id == trip_id),
        update(Contributor).where(Contributor.trip_id == trip_id).values(joined_via_invite_id=None),
        delete(TripInvite).where(TripInvite.trip_id == trip_id),
        delete(Contributor).where(Contributor.trip_id == trip_id),
        delete(Trip).where(Trip.id == trip_id),
    ]
    for statement in statements:
        db.execute(statement, execution_options=_NO_SYNC)


@router.get("/me/deletion-preview", response_model=AccountDeletionPreviewOut)
def deletion_preview(
    principal: Principal = Depends(get_current_principal), db: Session = Depends(get_db)
) -> AccountDeletionPreviewOut:
    """What DELETE /api/me would do to each of the caller's trips."""
    preview = AccountDeletionPreviewOut(handed_over=[], deleted=[], left=[])
    for member, trip, successor in _memberships(db, principal.email):
        if not member.is_owner:
            preview.left.append(DeletionTripOut(id=trip.id, name=trip.name))
        elif successor is None:
            preview.deleted.append(DeletionTripOut(id=trip.id, name=trip.name))
        else:
            preview.handed_over.append(
                DeletionTripOut(id=trip.id, name=trip.name, new_owner_name=successor.display_name)
            )
    return preview


@router.delete("/me", status_code=204)
def delete_account(
    background: BackgroundTasks,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    """Delete the caller's account: every trip membership, as described in
    this module's docstring. One transaction, so it's all or nothing.
    Signing out is the frontend's job afterwards (lib/api.js)."""
    events: list[tuple[int, str, dict]] = []
    forgotten: list[tuple[int, int]] = []
    deleted_trip_ids: list[int] = []

    for member, trip, successor in _memberships(db, principal.email):
        trip_id = trip.id
        if member.is_owner and successor is None:
            _delete_trip(db, trip_id)
            deleted_trip_ids.append(trip_id)
            continue
        if member.is_owner:
            successor.role = "owner"
            events.append((trip_id, "member.updated", {"contributor_id": successor.id, "role": "owner"}))
        member_id = member.id
        forgotten.extend(_remove_member(db, member))
        events.append((trip_id, "member.removed", {"contributor_id": member_id}))

    db.commit()

    for trip_id, event, data in events:
        bus.publish(trip_id, event, data)
    publish_forgotten(forgotten)
    for trip_id in deleted_trip_ids:
        background.add_task(photo_storage.delete_trip_photos, trip_id)
    return None
