from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import Principal, get_current_principal
from ..db import get_db
from ..models import Contributor, Trip
from ..permissions import TRIP_MANAGE, TRIP_READ, Access, Role, require, scopes_for
from ..schemas import TripCreate, TripOut, TripOwnerOut, TripUpdate

router = APIRouter(prefix="/api/trips", tags=["trips"])


def owner_of(db: Session, trip_id: int) -> Contributor | None:
    return db.scalar(select(Contributor).where(Contributor.trip_id == trip_id, Contributor.role == Role.owner.value))


def owner_out(owner: Contributor | None) -> TripOwnerOut | None:
    if owner is None:
        return None
    return TripOwnerOut(
        id=owner.id,
        display_name=owner.display_name,
        email=owner.email,
        initial=owner.initial,
        tint=owner.tint,
    )


def member_count(db: Session, trip_id: int) -> int:
    return db.scalar(select(func.count()).select_from(Contributor).where(Contributor.trip_id == trip_id)) or 0


def trip_out(db: Session, trip: Trip, member: Contributor) -> TripOut:
    """A trip as `member` sees it — the trip's own fields plus the caller's
    role and scopes, the owner, and the headcount."""
    return TripOut(
        id=trip.id,
        name=trip.name,
        region_line=trip.region_line,
        start_date=trip.start_date,
        end_date=trip.end_date,
        phase=trip.phase.value,
        traveller_count=trip.traveller_count,
        created_at=trip.created_at,
        my_role=member.role,
        my_scopes=sorted(scopes_for(member.role)),
        my_contributor_id=member.id,
        owner=owner_out(owner_of(db, trip.id)),
        member_count=member_count(db, trip.id),
    )


@router.get("", response_model=list[TripOut])
def list_trips(
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    """Only the trips the caller is on — as owner, contributor or reader.
    Oldest membership first, so a newly joined trip lands at the end of the
    list rather than reshuffling it."""
    rows = db.execute(
        select(Trip, Contributor)
        .join(Contributor, Contributor.trip_id == Trip.id)
        .where(Contributor.email == principal.email)
        .order_by(Contributor.joined_at, Trip.id)
    ).all()
    return [trip_out(db, trip, member) for trip, member in rows]


@router.post("", response_model=TripOut, status_code=201)
def create_trip(
    payload: TripCreate,
    principal: Principal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    trip = Trip(
        name=payload.name,
        region_line=payload.region_line,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    db.add(trip)
    db.flush()

    # The creator is the trip's one owner. Everyone else arrives through an
    # invite link (routers/sharing.py).
    owner = Contributor(
        trip_id=trip.id,
        email=principal.email,
        display_name=principal.display_name,
        initial=(principal.display_name[:1] or "?").upper(),
        role=Role.owner.value,
    )
    db.add(owner)
    db.commit()
    db.refresh(trip)
    db.refresh(owner)
    return trip_out(db, trip, owner)


@router.get("/{trip_id}", response_model=TripOut)
def get_trip(trip_id: int, access: Access = Depends(require(TRIP_READ)), db: Session = Depends(get_db)):
    trip = db.get(Trip, trip_id)
    return trip_out(db, trip, access.member)


@router.patch("/{trip_id}", response_model=TripOut)
def update_trip(
    trip_id: int,
    payload: TripUpdate,
    access: Access = Depends(require(TRIP_MANAGE)),
    db: Session = Depends(get_db),
):
    """Trip settings (name, regions, dates, travellers) — owner only. See
    the frontend's pages/TripSettings.jsx. Same immediate-edit,
    exclude_unset pattern as update_pin in app/routers/pins.py."""
    trip = db.get(Trip, trip_id)
    if trip is None:
        raise HTTPException(status_code=404, detail="Trip not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(trip, field, value)
    db.commit()
    db.refresh(trip)
    return trip_out(db, trip, access.member)
