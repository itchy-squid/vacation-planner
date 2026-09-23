"""Per-trip roles and the scopes they grant.

A person's access to a trip is one `Contributor` row with a `role`. The
role is the only thing stored; what it lets someone do is the fixed
mapping in ROLE_SCOPES below. Every trip-scoped endpoint names the scopes
it needs through `require(...)`, which is the single place membership and
scope are checked. Hiding a control in the UI is a convenience, not the
check.

The roles, from least to most:

- reader: looks, nothing more.
- companion: going on the trip, not running the plan. Adds ideas (and
  edits or deletes only their own), proposes blocks and keeps drafts,
  votes and comments. On a day the group has split, can move themselves
  (only themselves) from one branch to another. Can't place, move or remove
  anything on the calendar directly, and sees no costs except the ones on ideas they added
  themselves, which they can also set.
- planner: everything a companion can do, on anyone's ideas, plus direct
  placement and every cost on the trip. (Stored as "planner"; this role was
  called "contributor" before the companion role existed. The member row
  itself is still the `Contributor` model.)
- owner: a planner who also decides, runs the trip settings and manages
  people.

Costs are a read scope of their own. A caller without `costs:read` still
gets pins, travel items and plans, but every cost field in those responses
comes back as null — except, with `costs:own`, on a pin or travel item the
caller added. That redaction lives in the response schemas
(app/schemas.py) and reads `can_see_costs()` below, which `require` sets
for the request. It defaults to nothing visible, so a schema built outside
a permission-checked request shows no costs rather than leaking them.
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
from .models import Contest, Contributor, Pin, Plan, TravelItem, Traveler, Trip, TripInvite


class Role(str, enum.Enum):
    owner = "owner"
    planner = "planner"
    companion = "companion"
    reader = "reader"


# --- scopes -----------------------------------------------------------------

TRIP_READ = "trip:read"  # trip details, who's on it, the live event stream
IDEAS_READ = "ideas:read"  # pins, travel items, availability, comments
IDEAS_ADD = "ideas:add"  # add pins/travel items; edit/delete/availability on your own
IDEAS_WRITE = "ideas:write"  # edit/delete/availability on anyone's
PLANS_READ = "plans:read"  # the calendar, proposals and votes
PLANS_PROPOSE = "plans:propose"  # propose blocks, drafts, edit your own sets
PLANS_WRITE = "plans:write"  # place/move/remove plans on the calendar directly
PLANS_DECIDE = "plans:decide"  # pick a set, lock, reopen
PLANS_JOIN = "plans:join"  # move yourself between the branches of a split day
VOTES_WRITE = "votes:write"
COMMENTS_WRITE = "comments:write"
COSTS_READ = "costs:read"  # any cost figure, and who shares it
COSTS_WRITE = "costs:write"  # set cost_cents / heads on anything
COSTS_OWN = "costs:own"  # see and set cost_cents / heads on what you added
TRIP_MANAGE = "trip:manage"  # name, dates
TRAVELERS_MANAGE = "travelers:manage"  # add, edit and remove anyone on the traveler roster
MEMBERS_MANAGE = "members:manage"  # invite links, roles, removing people

_READER = frozenset({TRIP_READ, IDEAS_READ, PLANS_READ})
_COMPANION = _READER | {IDEAS_ADD, PLANS_PROPOSE, PLANS_JOIN, VOTES_WRITE, COMMENTS_WRITE, COSTS_OWN}
_PLANNER = _COMPANION | {IDEAS_WRITE, PLANS_WRITE, COSTS_READ, COSTS_WRITE, TRAVELERS_MANAGE}
_OWNER = _PLANNER | {PLANS_DECIDE, TRIP_MANAGE, MEMBERS_MANAGE}

ROLE_SCOPES: dict[Role, frozenset[str]] = {
    Role.reader: frozenset(_READER),
    Role.companion: frozenset(_COMPANION),
    Role.planner: frozenset(_PLANNER),
    Role.owner: frozenset(_OWNER),
}

# Roles an invite link (or the owner's role picker) can hand out. Ownership
# is never granted this way.
GRANTABLE_ROLES = (Role.planner, Role.companion, Role.reader)

# The roles that vote, and so count toward a contest's tally and majority.
VOTING_ROLES = tuple(role for role, scopes in ROLE_SCOPES.items() if VOTES_WRITE in scopes)


def scopes_for(role: Role | str) -> frozenset[str]:
    return ROLE_SCOPES[Role(role)]


# --- cost redaction -----------------------------------------------------------

@dataclass(frozen=True)
class _CostView:
    all: bool = False  # costs:read
    own_by: int | None = None  # with costs:own, the caller's member id


_cost_view: ContextVar[_CostView] = ContextVar("cost_view", default=_CostView())


def can_see_costs(added_by_id: int | None = None) -> bool:
    """Whether the current request may see a cost. `added_by_id` is who
    added the pin or travel item the cost belongs to; leave it out for a
    figure that isn't one person's (a plan's total)."""
    view = _cost_view.get()
    if view.all:
        return True
    return view.own_by is not None and added_by_id is not None and added_by_id == view.own_by


def set_cost_visibility(visible: bool, own_by: int | None = None) -> None:
    _cost_view.set(_CostView(all=visible, own_by=None if visible else own_by))


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

    def owns(self, added_by_id: int | None) -> bool:
        return added_by_id is not None and added_by_id == self.member.id

    def ensure_may_edit_idea(self, added_by_id: int | None) -> None:
        """Editing, deleting or re-timing a pin or travel item: anyone's
        with ideas:write, only your own with ideas:add."""
        if self.has(IDEAS_WRITE):
            return
        if self.has(IDEAS_ADD) and self.owns(added_by_id):
            return
        raise forbidden(IDEAS_WRITE, "You can only change ideas you added")

    def ensure_may_set_costs(self, added_by_id: int | None) -> None:
        """Setting a price or a cost split on a pin or travel item added by
        `added_by_id`: anything with costs:write, your own with costs:own."""
        if self.has(COSTS_WRITE):
            return
        if self.has(COSTS_OWN) and self.owns(added_by_id):
            return
        raise forbidden(COSTS_WRITE, "You can't change costs on this trip")


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
    "traveler_id": (Traveler, "Traveler not found"),
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
        set_cost_visibility(access.has(COSTS_READ), access.member.id if access.has(COSTS_OWN) else None)
        return access

    _bind.required_scopes = tuple(needed)  # read by tests/test_permissions.py
    return _bind


def invite_by_token(db: Session, token: str) -> TripInvite:
    invite = db.scalar(select(TripInvite).where(TripInvite.token == token))
    if invite is None or invite.revoked_at is not None:
        raise HTTPException(status_code=404, detail="This invite link doesn't work anymore")
    return invite
