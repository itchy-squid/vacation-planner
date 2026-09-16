"""Pydantic request/response models. Kept close to the ORM shape in
models.py; this is the contract the frontend's API client targets (see
frontend/src/lib/api.js)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from . import photo_storage
from .permissions import can_see_costs


class MeOut(BaseModel):
    """The signed-in principal (app/auth.py Principal), independent of any
    trip — see routers/me.py. Trip membership is a separate question,
    answered by ContributorOut below."""

    email: str
    display_name: str
    object_id: str | None = None
    identity_provider: str | None = None


class ContributorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    display_name: str
    initial: str
    tint: str
    # owner | contributor | reader — see app/permissions.py. is_owner is
    # kept for the screens that only ask that one question.
    role: Literal["owner", "contributor", "reader"]
    is_owner: bool
    joined_at: datetime


class ContributorRoleUpdate(BaseModel):
    """PATCH /api/trips/{trip_id}/contributors/{contributor_id}. Ownership
    can't be handed over this way."""

    role: Literal["contributor", "reader"]


class TripOwnerOut(BaseModel):
    id: int
    display_name: str
    email: str
    initial: str
    tint: str


class TripCreate(BaseModel):
    name: str
    region_line: str = ""
    start_date: date | None = None
    end_date: date | None = None


class TripOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    region_line: str
    start_date: date | None
    end_date: date | None
    phase: str
    # How many people the trip is costed for. None means "as many as there
    # are contributors" — see models.py Trip.
    traveller_count: int | None
    created_at: datetime
    # The caller's own standing on this trip, so the client can shape its
    # screens without a second request. The server checks every call
    # regardless; these are for hiding controls, not for enforcing.
    my_role: Literal["owner", "contributor", "reader"]
    my_scopes: list[str]
    my_contributor_id: int
    owner: TripOwnerOut | None
    member_count: int


class TripUpdate(BaseModel):
    """PATCH /api/trips/{id} — see app/routers/trips.py::update_trip.
    Unset fields are left alone (exclude_unset), same pattern as PinUpdate
    below."""

    name: str | None = None
    region_line: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    traveller_count: int | None = None


def _redact_costs(model: BaseModel, *fields: str) -> None:
    """Blank every cost field for a caller without costs:read (see
    app/permissions.py). None rather than 0: zero is a real price, and a
    client must be able to tell "free" from "not yours to see"."""
    if not can_see_costs():
        for field in fields:
            setattr(model, field, None)


class InviteCreate(BaseModel):
    role: Literal["contributor", "reader"]


class InviteOut(BaseModel):
    id: int
    role: Literal["contributor", "reader"]
    token: str
    created_at: datetime
    created_by_id: int | None
    joined_count: int


class InvitePreviewOut(BaseModel):
    """What someone holding a link sees before joining — GET
    /api/invites/{token}. Enough to recognise the trip and the role, and
    nothing a member-only endpoint would otherwise guard (no pins, plans or
    costs)."""

    trip_id: int
    trip_name: str
    region_line: str
    start_date: date | None
    end_date: date | None
    phase: str
    role: Literal["contributor", "reader"]
    owner: TripOwnerOut | None
    member_count: int
    # Already on the trip: the client skips the confirm step and opens it.
    # Their role is left as it is.
    already_member: bool
    my_role: Literal["owner", "contributor", "reader"] | None = None


class AvailabilityRuleIn(BaseModel):
    days: list[int] = Field(default_factory=list)
    bands: list[str] = Field(default_factory=list)
    reasons: list[str] = Field(default_factory=list)


class AvailabilityRuleOut(AvailabilityRuleIn):
    model_config = ConfigDict(from_attributes=True)


class AvailabilityOverrideOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    day: int
    band: str


class PinCreate(BaseModel):
    title: str
    short: str
    place: str
    region: str
    lat: float | None = None
    lng: float | None = None
    duration_minutes: int = 60
    cost_cents: int = 0
    notes: str = ""
    link: str = ""
    tags: list[str] = Field(default_factory=list)
    # Pasted directly by the person adding the pin (see pages/NewPin.jsx)
    # rather than scraped from the link's page — a plain server-side
    # fetch can't see photos a site injects client-side after load, and
    # plenty of real pages do exactly that. photo_url is the image
    # itself, hotlinked rather than copied; photo_source_url is the page
    # it came from, kept so the pin can credit and link back to it.
    photo_url: str | None = None
    photo_source_url: str | None = None


class PinUpdate(BaseModel):
    title: str | None = None
    region: str | None = None
    duration_minutes: int | None = None
    cost_cents: int | None = None
    # Contributor ids sharing this pin's cost; [] means everyone on the
    # trip. Edited as a row of initial chips on pages/EditVisit.jsx.
    heads: list[int] | None = None
    notes: str | None = None
    link: str | None = None
    tags: list[str] | None = None
    photo_url: str | None = None
    photo_source_url: str | None = None


class PinOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    trip_id: int
    title: str
    short: str
    place: str
    region: str
    lat: float | None
    lng: float | None
    duration_minutes: int
    # None when the caller can't see costs (costs:read).
    cost_cents: int | None
    heads: list[int] | None
    notes: str
    link: str
    tags: list[str]
    photo_url: str | None
    photo_source_url: str | None
    added_by_id: int | None
    added_at: datetime
    # Included so the frontend can render the availability grid straight off
    # the pin fetch (list or detail) without a second round trip — see
    # app/routers/pins.py for how these are written.
    availability_rule: "AvailabilityRuleOut | None" = None
    availability_overrides: list[AvailabilityOverrideOut] = Field(default_factory=list)

    @model_validator(mode="after")
    def _sign_photo_url(self) -> "PinOut":
        """The stored photo_url is a blob's *base* URL, good for exactly
        as long as the blob exists — it's photo_storage.mirror_photo_to_
        blob's job to fill it in, not this schema's. What actually reaches
        a client needs a short-lived SAS query string appended, since the
        container is private (see photo_storage.py's module docstring for
        why). Every pin response passes through here — list_pins,
        get_pin, create_pin, update_pin, and the pin nested inside a
        calendar PlanItemOut — so this is the one place that needs to
        remember to sign it, rather than every call site.

        A pin whose photo_url isn't one of ours (still hotlinked, because
        storage isn't configured or the mirror hasn't run yet) is left
        exactly as stored; signing only ever applies to our own blobs."""
        if self.photo_url and photo_storage.is_our_blob_url(self.photo_url):
            self.photo_url = photo_storage.sign_photo_url(self.photo_url)
        return self

    @model_validator(mode="after")
    def _hide_costs(self) -> "PinOut":
        _redact_costs(self, "cost_cents", "heads")
        return self


class AvailabilityOverrideToggle(BaseModel):
    day: int
    band: str


# One "travel" kind rather than flight/train/drive/ferry: the distinction
# never reached anything — no icon, filter, cost rule or sort has ever read
# it — while the split was actively wrong in two ways. The day form offered
# a "ferry" this Literal rejected, so creating one 422'd; and a trip's legs
# are routinely mixed (the Xiaoliuqiu run is a train *and* a ferry), which
# forced a single item into whichever half-truth the author picked first.
# "lodging" stays because it genuinely behaves differently — it spans a
# night rather than a leg — and "other" stays as the catch-all the custom
# event form writes.
TravelItemKind = Literal["travel", "lodging", "other"]


class TravelItemCreate(BaseModel):
    title: str
    kind: TravelItemKind = "other"
    duration_minutes: int = 60
    cost_cents: int = 0
    notes: str = ""
    link: str = ""


class TravelItemUpdate(BaseModel):
    title: str | None = None
    kind: TravelItemKind | None = None
    duration_minutes: int | None = None
    cost_cents: int | None = None
    heads: list[int] | None = None
    notes: str | None = None
    link: str | None = None


class TravelItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    trip_id: int
    title: str
    kind: str
    duration_minutes: int
    cost_cents: int | None
    heads: list[int] | None
    notes: str
    link: str
    added_by_id: int | None
    added_at: datetime

    @model_validator(mode="after")
    def _hide_costs(self) -> "TravelItemOut":
        _redact_costs(self, "cost_cents", "heads")
        return self


class PlanItemCreate(BaseModel):
    pin_id: int | None = None
    travel_item_id: int | None = None
    # A trim, local to this placement — the pin/travel item's own duration
    # is untouched (feature spec decision 2). Floor of 15m matches the
    # stepper everywhere else in the app.
    duration_minutes: int | None = Field(default=None, ge=15)
    # Start, in minutes from the plan's own start. NULL packs this stop end
    # to end behind the ones before it, which is what a stop nobody has
    # given a time to means — see app/derive.py item_start_minutes, which
    # resolves the stored column by the same rule.
    offset_minutes: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _exactly_one_target(self) -> "PlanItemCreate":
        if (self.pin_id is None) == (self.travel_item_id is None):
            raise ValueError("Exactly one of pin_id or travel_item_id must be set")
        return self


class PlanItemOut(BaseModel):
    pin: PinOut | None = None
    travel_item: TravelItemOut | None = None
    position: int
    # Both nullable overrides, echoed back as stored so a client can tell
    # "trimmed to 90m" from "the pin is 90m" — that's the difference
    # between the proposal flow showing "1H 30M · SHORTENED FROM 3H" and
    # just "1H 30M".
    duration_minutes: int | None = None
    offset_minutes: int | None = None
    # Pre-computed clock position, so the Expenses page and the compare /
    # itinerary stop lists don't each re-derive the packing rule (feature
    # spec §7). Minutes from midnight on the plan's own day.
    start_minute_of_day: int


PlanStatusLiteral = Literal["draft", "placed", "pencilled", "contested", "locked"]


class PlanCreate(BaseModel):
    """Direct placement — POST /api/trips/{trip_id}/plans. `status` is
    restricted to placed/pencilled/draft here: contested/locked plans only
    ever come out of the propose-a-block and lock flows (see
    routers/contests.py), never straight from a client-supplied status.

    `draft` is allowed because a draft is exactly a plan its author hasn't
    shown anyone yet — it occupies no time and is filtered out of every
    other contributor's reads (feature spec §6.4), so nothing is claimed by
    creating one."""

    starts_at: datetime
    ends_at: datetime
    status: Literal["placed", "pencilled", "draft"] = "placed"
    label: str = ""
    rationale: str = ""
    items: list[PlanItemCreate] = Field(default_factory=list)


class ProposalUpdate(BaseModel):
    """Rewrite a candidate plan — PUT /api/plans/{id}/stops.

    The whole set, not a patch of it: a proposal is a window plus an
    ordered list of stops with times, and there is no partial edit of that
    worth an endpoint. It is also exactly what the propose screen holds
    while someone is working, so the screen that builds a set and the one
    that edits a set can be the same screen sending the same body.

    The window is deliberately absent. Every option in a contest spans
    exactly the contest's hours, so editing a set never moves them.
    """

    label: str = ""
    rationale: str = ""
    items: list[PlanItemCreate] = Field(min_length=1)


class PlanMove(BaseModel):
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class PlanOut(BaseModel):
    id: int
    trip_id: int
    starts_at: datetime
    ends_at: datetime
    label: str
    color: str
    status: PlanStatusLiteral
    contest_id: int | None
    created_by_id: int | None
    # The proposer's case for this plan, shown to voters.
    rationale: str
    items: list[PlanItemOut]
    # Derived, never stored — see app/derive.py. There is no
    # moving_minutes any more; see that module's docstring for why.
    total_duration_minutes: int
    total_cost_cents: int | None
    slack_minutes: int

    @model_validator(mode="after")
    def _hide_costs(self) -> "PlanOut":
        _redact_costs(self, "total_cost_cents")
        return self


class ContestProposeCreate(BaseModel):
    """Propose a block — POST /api/trips/{trip_id}/contests.

    There is no `against_plan_id` any more: a proposal claims a *window*,
    not one existing plan. Everything already in those hours is captured
    into a single incumbent option, which is what makes locking the winner
    safe — see routers/contests.py::open_block_contest and the feature
    spec's decision 1."""

    starts_at: datetime
    ends_at: datetime
    label: str = ""
    rationale: str = ""
    items: list[PlanItemCreate] = Field(default_factory=list)


class ContestPlanOut(PlanOut):
    vote_count: int
    voted_by_me: bool
    # Derived, not stored: options are lettered by created_at with the
    # incumbent first, so A is always what's already on the board. A letter
    # can therefore shift if an option is removed — which is the right
    # trade for never having a stored letter disagree with the order the
    # cards are actually drawn in.
    set_letter: str


class ContestOut(BaseModel):
    id: int
    trip_id: int
    status: Literal["open", "resolved"]
    winning_plan_id: int | None
    # The hours under contest. Every option spans exactly these.
    starts_at: datetime
    ends_at: datetime
    plans: list[ContestPlanOut]
    voted_count: int
    contributor_count: int
    # The plan holding strictly more than half of contributor_count, or
    # None. Advisory only — nothing resolves automatically; the owner still
    # picks a set (feature spec decision 4).
    majority_plan_id: int | None = None
    # Which plan the requesting principal has voted for in this contest, if
    # any — lets the frontend show "Voted ✓" without a separate lookup. See
    # app/routers/contests.py::_contest_to_schema.
    my_vote_plan_id: int | None = None


class VoteToggle(BaseModel):
    plan_id: int


class PickRequest(BaseModel):
    plan_id: int


class ContestPicked(BaseModel):
    """What picking a set leaves behind: one placed plan per stop. The
    contest itself is gone — see routers/contests.py pick_set."""

    placed_plans: list[PlanOut]


class CommentCreate(BaseModel):
    body: str
    pin_id: int | None = None
    plan_id: int | None = None


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    body: str
    contributor_id: int
    pin_id: int | None
    plan_id: int | None
    created_at: datetime
