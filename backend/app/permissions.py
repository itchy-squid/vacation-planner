"""Per-trip roles and the scopes they grant.

A person's access to a trip is one `Contributor` row with a `role`. The
role is the only thing stored; what it lets someone do is the fixed
mapping in ROLE_SCOPES below. Every trip-scoped endpoint names the scopes
it needs through `require(...)`, which is the single place membership and
scope are checked. Hiding a control in the UI is a convenience, not the
check.

Costs are a read scope of their own. A caller without `costs:read` still
gets pins, travel items and plans, but every cost field in those responses
comes back as null. That redaction lives in the response schemas
(app/schemas.py) and reads `can_see_costs()` below, which `require` sets
for the request. It defaults to False, so a schema built outside a
permission-checked request shows no costs rather than leaking them.
"""

from __future__ import annotations

import enum
from contextvars import ContextVar
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import Principal, get_current_principal
from .db import get_db
from .models import Contest, Contributor, Pin, Plan, TravelItem, Trip, TripInvite


class Role(str, enum.Enum):
    owner = "owner"
    contributor = "contributor"
    reader = "reader"


# --- scopes -----------------------------------------------------------------

TRIP_READ = "trip:read"  # trip details, who's on it, the live event stream
IDEAS_READ = "ideas:read"  # pins, travel items, availability, comments
IDEAS_WRITE = "ideas:write"  # add/edit/delete pins, travel items, availability
PLANS_READ = "plans:read"  # the calendar, proposals and votes
PLANS_WRITE = "plans:write"  # place/move/remove plans, propose, drafts
PLANS_DECIDE = "plans:decide"  # pick a set, lock, reopen
VOTES_WRITE = "votes:write"
COMMENTS_WRITE = "comments:write"
COSTS_READ = "costs:read"  # any cost figure, and who shares it
COSTS_WRITE = "costs:write"  # set cost_cents / heads
TRIP_MANAGE = "trip:manage"  # name, dates, traveller count
MEMBERS_MANAGE = "members:manage"  # invite links, roles, removing people

_READER = frozenset({TRIP_READ, IDEAS_READ, PLANS_READ})
_CONTRIBUTOR = _READER | {IDEAS_WRITE, PLANS_WRITE, VOTES_WRITE, COMMENTS_WRITE, COSTS_READ, COSTS_WRITE}
_OWNER = _CONTRIBUTOR | {PLANS_DECIDE, TRIP_MANAGE, MEMBERS_MANAGE}

ROLE_SCOPES: dict[Role, frozenset[str]] = {
    Role.reader: frozenset(_READER),
    Role.contributor: frozenset(_CONTRIBUTOR),
    Role.owner: frozenset(_OWNER),
}

# Roles an invite link (or the owner's role picker) can hand out. Ownership
# is never granted this way.
GRANTABLE_ROLES = (Role.contributor, Role.reader)


def scopes_for(role: Role | str) -> frozenset[str]:
    return ROLE_SCOPES[Role(role)]


# --- cost redaction -----------------------------------------------------------

_cost_visible: ContextVar[bool] = ContextVar("cost_visible", default=False)


def can_see_costs() -> bool:
    return _cost_visible.get()


def set_cost_visibility(visible: bool) -> None:
    _cost_visible.set(visible)


# --- access -------------------------------------------------------------------


@dataclass(frozen=True)
class Access:
    trip_id: int
    member: Contributor
    role: Role
    scopes: frozenset[str]

    def has(self, scope: str) -> bool:
        return scope in self.scopes

    def ensure(self, scope: str, message: str | None = None) -> None:
        if scope not in self.scopes:
            raise forbidden(scope, message)


def forbidden(scope: str, message: str | None = None) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={"message": message or "You don't have permission to do that on this trip", "missing_scope": scope},
    )


def member_for(db: Session, trip_id: int, email: str) -> Contributor | None:
    return db.scalar(select(Contributor).where(Contributor.trip_id == trip_id, Contributor.email == email))


def access_for(db: Session, trip_id: int, principal: Principal) -> Access | None:
    member = member_for(db, trip_id, principal.email)
    if member is None:
        return None
    role = Role(member.role)
    return Access(trip_id=trip_id, member=member, role=role, scopes=ROLE_SCOPES[role])


# Path parameters that identify something belonging to a trip, and how to
# find that trip. `trip_id` itself wins when a path carries it.
_OWNING_MODELS = {
    "pin_id": (Pin, "Pin not found"),
    "plan_id": (Plan, "Plan not found"),
    "contest_id": (Contest, "Contest not found"),
    "travel_item_id": (TravelItem, "Travel item not found"),
}


def _trip_id_for_path(request: Request, db: Session) -> int:
    params = request.path_params
    if "trip_id" in params:
        trip_id = int(params["trip_id"])
        if db.get(Trip, trip_id) is None:
            raise HTTPException(status_code=404, detail="Trip not found")
        return trip_id
    for name, (model, not_found) in _OWNING_MODELS.items():
        if name in params:
            row = db.get(model, int(params[name]))
            if row is None:
                raise HTTPException(status_code=404, detail=not_found)
            return row.trip_id
    raise RuntimeError(f"require() used on a path with no trip-owned parameter: {request.url.path}")


def require(*needed: str):
    """Dependency factory: the caller must be on the trip the path points at
    and hold every scope in `needed`. Returns the caller's Access.

    Two layers on purpose. The sync layer does the database work (in
    FastAPI's threadpool, like every other sync dependency here). The async
    layer runs on the request's own task, which is the only place a
    ContextVar set now is still visible when the response is serialized, so
    that's where cost visibility is recorded."""

    def _check(
        request: Request,
        principal: Principal = Depends(get_current_principal),
        db: Session = Depends(get_db),
    ) -> Access:
        trip_id = _trip_id_for_path(request, db)
        access = access_for(db, trip_id, principal)
        if access is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"message": "You're not on this trip", "missing_scope": TRIP_READ},
            )
        for scope in needed:
            access.ensure(scope)
        return access

    async def _bind(access: Access = Depends(_check)) -> Access:
        set_cost_visibility(access.has(COSTS_READ))
        return access

    _bind.required_scopes = tuple(needed)  # read by tests/test_permissions.py
    return _bind


def invite_by_token(db: Session, token: str) -> TripInvite:
    invite = db.scalar(select(TripInvite).where(TripInvite.token == token))
    if invite is None or invite.revoked_at is not None:
        raise HTTPException(status_code=404, detail="This invite link doesn't work anymore")
    return invite
