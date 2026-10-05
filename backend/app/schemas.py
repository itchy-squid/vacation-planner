"""Pydantic request/response models. Kept close to the ORM shape in
models.py; this is the contract the frontend's API client targets (see
frontend/src/lib/api.js)."""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from . import photo_storage
from .permissions import can_see_costs


# --- links a person pasted ------------------------------------------------------

# Browsers drop tabs and newlines anywhere in a URL and ignore leading
# control characters and spaces, so "java\tscript:" is still javascript:.
# Normalise the same way before reading the scheme.
_URL_IGNORED = re.compile(r"[\t\n\r]")
_URL_LEADING_IGNORED = "".join(chr(c) for c in range(0x21))  # C0 controls and space
_URL_SCHEME = re.compile(r"^([a-z][a-z0-9+.-]*):", re.IGNORECASE)
_WEB_SCHEMES = {"http", "https"}


def _web_link(value: str | None) -> str | None:
    """A link someone else on the trip will open: http(s), or no scheme at
    all (the frontend reads "example.com" as https://example.com). Anything
    else — javascript:, data:, vbscript: — is refused rather than stored,
    since it would run in whoever clicks it (frontend/src/lib/externalHref.js
    is the client-side half of the same rule)."""
    if not value:
        return value
    normalised = _URL_IGNORED.sub("", value).lstrip(_URL_LEADING_IGNORED)
    match = _URL_SCHEME.match(normalised)
    if match and match.group(1).lower() not in _WEB_SCHEMES:
        raise ValueError("Links have to start with http:// or https://")
    return value


WebLink = Annotated[str, AfterValidator(_web_link)]


class MeOut(BaseModel):
    """The signed-in principal (app/auth.py Principal), independent of any
    trip — see routers/me.py. Trip membership is a separate question,
    answered by ContributorOut below."""

    email: str
    display_name: str
    object_id: str | None = None
    identity_provider: str | None = None


class DeletionTripOut(BaseModel):
    id: int
    name: str
    # Only for a trip being handed over: who becomes its owner.
    new_owner_name: str | None = None


class AccountDeletionPreviewOut(BaseModel):
    """What deleting your account does to each of your trips — see
    routers/account.py."""

    handed_over: list[DeletionTripOut]  # you own it; someone else takes over
    deleted: list[DeletionTripOut]  # you own it and nobody else is on it
    left: list[DeletionTripOut]  # you're a member; you leave it


class ContributorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    display_name: str
    initial: str
    tint: str
    # owner | planner | companion | reader — see app/permissions.py. is_owner is
    # kept for the screens that only ask that one question.
    role: Literal["owner", "planner", "companion", "reader"]
    is_owner: bool
    joined_at: datetime


class ContributorRoleUpdate(BaseModel):
    """PATCH /api/trips/{trip_id}/contributors/{contributor_id}. Ownership
    can't be handed over this way."""

    role: Literal["planner", "companion", "reader"]


class TripOwnerOut(BaseModel):
    id: int
    display_name: str
    email: str
    initial: str
    tint: str


class TripInviteeIn(BaseModel):
    """One person invited as a new trip is created ("Who's planning with
    you?"). Must be someone the creator has planned a trip with before
    (GET /api/people). `traveling` lists them on the roster straight
    away, so costs split with them from the start; they claim that row
    when they accept."""

    email: str = Field(min_length=3, max_length=320)
    role: Literal["planner", "companion", "reader"] = "planner"
    traveling: bool = True


class TripCreate(BaseModel):
    name: str
    region_line: str = ""
    start_date: date | None = None
    end_date: date | None = None
    invitees: list[TripInviteeIn] = Field(default_factory=list, max_length=50)


class TripOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    region_line: str
    start_date: date | None
    end_date: date | None
    phase: str
    # How many travelers are listed (models.Traveler) — the people the
    # trip is for and the costs are split between.
    traveler_count: int = 0
    created_at: datetime
    # The caller's own standing on this trip, so the client can shape its
    # screens without a second request. The server checks every call
    # regardless; these are for hiding controls, not for enforcing.
    my_role: Literal["owner", "planner", "companion", "reader"]
    my_scopes: list[str]
    my_contributor_id: int
    # The caller's own traveler, or None when they're planning but not
    # going. What "just me" and "what I'm paying" are measured from.
    my_traveler_id: int | None = None
    owner: TripOwnerOut | None
    member_count: int


class TravelerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    trip_id: int
    name: str
    initial: str
    tint: str
    contributor_id: int | None
    paid_by_id: int | None
    position: int
    # A live invite link made for this traveler and not yet used.
    invited: bool = False


class TravelerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    paid_by_id: int | None = None
    # Link to an existing member (someone on the People list who's going).
    contributor_id: int | None = None


class TravelerUpdate(BaseModel):
    """PATCH /api/travelers/{id}; unset fields are left alone, and an
    explicit null paid_by_id means "pays for themselves"."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    paid_by_id: int | None = None
    contributor_id: int | None = None


class TravelerInviteCreate(BaseModel):
    role: Literal["planner", "companion", "reader"] = "companion"


class TravelerBrief(BaseModel):
    """A listed traveler as the join screen shows them."""

    id: int
    name: str
    initial: str
    tint: str
    paid_by_name: str | None = None


class InviteAccept(BaseModel):
    """POST /api/invites/{token}/accept. Which traveler you are: one
    already listed (`traveler_id`), nobody (`not_going`), or — with
    neither — a new one with your name. A link made for one traveler
    decides this itself."""

    traveler_id: int | None = None
    not_going: bool = False


class TripUpdate(BaseModel):
    """PATCH /api/trips/{id} — see app/routers/trips.py::update_trip.
    Unset fields are left alone (exclude_unset), same pattern as PinUpdate
    below."""

    name: str | None = None
    region_line: str | None = None
    start_date: date | None = None
    end_date: date | None = None


def _redact_costs(model: BaseModel, *fields: str, added_by_id: int | None = None) -> None:
    """Blank every cost field for a caller who can't see this cost (no
    costs:read, and no costs:own on something they added — see
    app/permissions.py). None rather than 0: zero is a real price, and a
    client must be able to tell "free" from "not yours to see"."""
    if not can_see_costs(added_by_id):
        for field in fields:
            setattr(model, field, None)


class PersonTripOut(BaseModel):
    """A trip the caller shared with someone, and that person's role on it."""

    id: int
    name: str
    start_date: date | None
    end_date: date | None
    role: Literal["owner", "planner", "companion", "reader"]


class PersonOut(BaseModel):
    """Someone the caller has planned a trip with — GET /api/people.
    People are matched by email, like members (there is no user table)."""

    email: str
    display_name: str
    initial: str
    tint: str
    # Their role on the most recent trip you shared — what a new invite
    # suggests for them.
    last_role: Literal["owner", "planner", "companion", "reader"]
    # Most recent first.
    trips: list[PersonTripOut]


class DirectInviteOut(BaseModel):
    """An invite waiting for the caller — GET /api/me/invites. Accept it
    with the existing POST /api/invites/{token}/accept, or decline with
    POST /api/invites/{token}/decline."""

    id: int
    token: str
    trip_id: int
    trip_name: str
    start_date: date | None
    end_date: date | None
    phase: str
    role: Literal["planner", "companion", "reader"]
    invited_by: TripOwnerOut | None
    member_count: int
    # A traveler is already listed for them, so joining makes them that
    # traveler; false means they're invited to help plan only.
    traveling: bool
    created_at: datetime


class InviteCreate(BaseModel):
    role: Literal["planner", "companion", "reader"]


class InviteOut(BaseModel):
    id: int
    role: Literal["planner", "companion", "reader"]
    token: str
    created_at: datetime
    created_by_id: int | None
    joined_count: int
    # Set on a link made for one listed traveler.
    traveler_id: int | None = None


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
    role: Literal["planner", "companion", "reader"]
    owner: TripOwnerOut | None
    member_count: int
    # Already on the trip: the client skips the confirm step and opens it.
    # Their role is left as it is.
    already_member: bool
    my_role: Literal["owner", "planner", "companion", "reader"] | None = None
    # The traveler this link was made for, if it was made for one; the
    # join screen then just confirms rather than asking.
    invite_traveler: TravelerBrief | None = None
    # Everyone listed who hasn't got an account yet — "are you one of
    # these?"
    unclaimed_travelers: list[TravelerBrief] = Field(default_factory=list)


# What a cost_cents figure means: what one person pays, or one price for
# everyone sharing it. See app/derive.py item_money.
CostBasis = Literal["per_head", "group"]

# How often it's paid: once, or per 24 hours — n days from first to last
# is (n - 1) days' worth (models.py Pin.cost_per).
CostPer = Literal["once", "day"]

# Something to do (takes time on the Plan tab), or somewhere to sleep
# (models.py Pin.kind).
PinKind = Literal["activity", "stay"]


def _check_cost_days(pin: BaseModel, fields_set: set[str] | None = None) -> None:
    """The days a per-day price covers are both given or neither (on an
    update, both sent or neither; both null clears them), and run
    forwards."""
    if fields_set is not None and ("cost_start_date" in fields_set) != ("cost_end_date" in fields_set):
        raise ValueError("cost_start_date and cost_end_date must be given together")
    if (pin.cost_start_date is None) != (pin.cost_end_date is None):
        raise ValueError("cost_start_date and cost_end_date must be given together")
    if pin.cost_start_date is not None and pin.cost_end_date < pin.cost_start_date:
        raise ValueError("The last day can't be before the first")


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


def _check_location(pin: BaseModel, fields_set: set[str] | None = None) -> None:
    """A pin's location is all or nothing: lat and lng together (on an
    update, both sent or neither; both null clears it), and a Google place
    ID only with the coordinates it was found at. Anything else would leave
    a pin the map can't draw, or a place ID pointing at somewhere the pin
    isn't."""
    if fields_set is not None and ("lat" in fields_set) != ("lng" in fields_set):
        raise ValueError("lat and lng must be given together")
    if (pin.lat is None) != (pin.lng is None):
        raise ValueError("lat and lng must be given together")
    if pin.google_place_id is not None and pin.lat is None:
        raise ValueError("google_place_id needs the location it was found at (lat and lng)")


Latitude = Annotated[float, Field(ge=-90, le=90)]
Longitude = Annotated[float, Field(ge=-180, le=180)]
GooglePlaceId = Annotated[str, Field(min_length=1, max_length=300)]


class PinCreate(BaseModel):
    title: str
    place: str
    region: str
    # From a place search (pages/NewPin.jsx); left out otherwise.
    lat: Latitude | None = None
    lng: Longitude | None = None
    google_place_id: GooglePlaceId | None = None
    kind: PinKind = "activity"
    duration_minutes: int = 60
    cost_cents: int = 0
    cost_basis: CostBasis = "per_head"
    cost_per: CostPer = "once"
    cost_start_date: date | None = None
    cost_end_date: date | None = None
    notes: str = ""
    link: WebLink = ""
    tags: list[str] = Field(default_factory=list)
    # Pasted directly by the person adding the pin (see pages/NewPin.jsx)
    # rather than scraped from the link's page — a plain server-side
    # fetch can't see photos a site injects client-side after load, and
    # plenty of real pages do exactly that. photo_url is the image
    # itself, hotlinked rather than copied; photo_source_url is the page
    # it came from, kept so the pin can credit and link back to it.
    photo_url: WebLink | None = None
    photo_source_url: WebLink | None = None

    @model_validator(mode="after")
    def _location_is_all_or_nothing(self) -> "PinCreate":
        _check_location(self)
        _check_cost_days(self)
        return self


class PinUpdate(BaseModel):
    title: str | None = None
    region: str | None = None
    kind: PinKind | None = None
    duration_minutes: int | None = None
    cost_cents: int | None = None
    cost_basis: CostBasis | None = None
    cost_per: CostPer | None = None
    # Send together; both null clears them.
    cost_start_date: date | None = None
    cost_end_date: date | None = None
    notes: str | None = None
    link: WebLink | None = None
    tags: list[str] | None = None
    photo_url: WebLink | None = None
    photo_source_url: WebLink | None = None
    # An exact spot set after the pin was added (the Map tab's "Pin a spot").
    # Send lat and lng together; both null removes it. Coordinates without
    # google_place_id clear any place ID (routers/pins.py update_pin).
    lat: Latitude | None = None
    lng: Longitude | None = None
    google_place_id: GooglePlaceId | None = None
    # "None of these" in the "On Google Maps?" review: don't offer it again.
    google_review_dismissed: bool | None = None

    @model_validator(mode="after")
    def _location_is_all_or_nothing(self) -> "PinUpdate":
        _check_location(self, self.model_fields_set)
        _check_cost_days(self, self.model_fields_set)
        return self


class TripRegionIn(BaseModel):
    """PUT /api/trips/{id}/regions: where a region is, by name. Setting a
    name the trip already has (in any case) replaces its location."""

    name: str = Field(min_length=1, max_length=120)
    lat: Latitude
    lng: Longitude
    south: Latitude
    west: Longitude
    north: Latitude
    east: Longitude

    @model_validator(mode="after")
    def _south_of_north(self) -> "TripRegionIn":
        # West may be east of east: an area can cross the antimeridian.
        if self.south > self.north:
            raise ValueError("south must not be north of north")
        return self


class TripRegionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    lat: float
    lng: float
    south: float
    west: float
    north: float
    east: float


# --- where we'll be (app/models.py TripDayPlace) ----------------------------------

def _place_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("A place needs a name")
    return value


PlaceName = Annotated[str, Field(max_length=120), AfterValidator(_place_name)]


class DayPlaces(BaseModel):
    """The places for one date: where the group stays that night, and its
    day trips in the order they're gone to. No stay and no day trips means
    the day isn't set."""

    date: date
    stay: PlaceName | None = None
    # The idea the group is staying at that night (the hotel), when one
    # has been picked. Only a day with a stay can have one.
    lodging_pin_id: int | None = None
    visits: list[PlaceName] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def _each_place_once(self) -> "DayPlaces":
        keys = [name.lower() for name in self.visits]
        if len(set(keys)) != len(keys):
            raise ValueError("A day trip is listed twice")
        if self.stay is not None and self.stay.lower() in keys:
            raise ValueError("A day can't have a day trip to where it's staying")
        if self.lodging_pin_id is not None and self.stay is None:
            raise ValueError("Say where you're staying before choosing the place you're staying at")
        return self


class DayPlacesUpdate(BaseModel):
    """PUT /api/trips/{id}/day-places: replaces the places on each listed
    date; a day with no stay and no day trips is cleared. Dates not listed
    are left alone."""

    days: list[DayPlaces] = Field(min_length=1, max_length=366)

    @model_validator(mode="after")
    def _each_date_once(self) -> "DayPlacesUpdate":
        dates = [day.date for day in self.days]
        if len(set(dates)) != len(dates):
            raise ValueError("A date is listed twice")
        return self


class PinOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    trip_id: int
    title: str
    place: str
    region: str
    lat: float | None
    lng: float | None
    google_place_id: str | None = None
    google_review_dismissed: bool = False
    kind: str = "activity"
    duration_minutes: int
    # None when the caller can't see costs (costs:read).
    cost_cents: int | None
    cost_basis: str = "per_head"
    cost_per: str = "once"
    cost_start_date: date | None = None
    cost_end_date: date | None = None
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
    # Contributor ids of everyone who has hearted this pin, earliest first
    # (app/models.py PinHeart). Its length is the pin's popularity.
    hearted_by: list[int] = Field(default_factory=list)

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
        _redact_costs(self, "cost_cents", added_by_id=self.added_by_id)
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

# How a ride planned on the Map tab gets there (models.py TravelItem.mode).
TravelMode = Literal["car", "bus", "train", "walk"]


def _mode_needs_travel(kind: str | None, mode: str | None) -> None:
    if mode is not None and kind is not None and kind != "travel":
        raise ValueError("Only a travel item can have a travel mode")


class TravelItemCreate(BaseModel):
    title: str
    kind: TravelItemKind = "other"
    duration_minutes: int = 60
    cost_cents: int = 0
    cost_basis: CostBasis = "per_head"
    notes: str = ""
    link: WebLink = ""
    mode: TravelMode | None = None
    distance_meters: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _mode_only_on_travel(self) -> "TravelItemCreate":
        _mode_needs_travel(self.kind, self.mode)
        return self


class TravelItemUpdate(BaseModel):
    """A mode can't be set here without the kind: which kind the item
    already is lives in the database, so routers/travel_items.py checks
    the pair once the two are merged."""

    title: str | None = None
    kind: TravelItemKind | None = None
    duration_minutes: int | None = None
    cost_cents: int | None = None
    cost_basis: CostBasis | None = None
    notes: str | None = None
    link: WebLink | None = None
    mode: TravelMode | None = None
    distance_meters: int | None = Field(default=None, ge=0)


class TravelItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    trip_id: int
    title: str
    kind: str
    duration_minutes: int
    cost_cents: int | None
    cost_basis: str = "per_head"
    notes: str
    link: str
    mode: str | None = None
    distance_meters: int | None = None
    added_by_id: int | None
    added_at: datetime

    @model_validator(mode="after")
    def _hide_costs(self) -> "TravelItemOut":
        _redact_costs(self, "cost_cents", added_by_id=self.added_by_id)
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
    # Money for this stop, worked out on the server because it depends on
    # who is on the plan (app/derive.py item_money): the travelers sharing
    # it, what each of them pays, and the whole bill. Costs are None for a
    # caller who can't see this one.
    sharer_ids: list[int] = Field(default_factory=list)
    each_cents: int | None = None
    total_cents: int | None = None


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
    # The group this plan is for when the group has split up; None is
    # everyone. See app/splits.py for where each may go.
    branch_id: int | None = None


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


class ContestMove(BaseModel):
    """Move a lone proposal's hours — PATCH /api/contests/{id}.

    Both edges, always: the window is the contest's, and a proposal with
    nothing competing for it moves as one block, stops and all (their
    offsets are relative to the window's start, so they ride along)."""

    starts_at: datetime
    ends_at: datetime


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
    # Who this plan is for: its group on a split day (app/splits.py), or
    # None for everyone — plus, so no screen has to look the group up, the
    # travelers that comes to right now.
    branch_id: int | None = None
    party_members: list[int] = Field(default_factory=list)
    for_everyone: bool = True
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
    # The group the decision is for on a split day; None is the whole trip.
    # Only that group's plans are captured, and only its travelers vote.
    branch_id: int | None = None


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
    # Who the decision is for, and so who votes (app/splits.py).
    branch_id: int | None = None
    party_members: list[int] = Field(default_factory=list)
    for_everyone: bool = True
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


class WithdrawResult(BaseModel):
    """What withdrawing a set leaves behind. `contest` is the vote as it now
    stands, or None once nothing was left to decide: then `placed_plans` are
    the stops that went back on the calendar (only when a set already on the
    board was left standing). See routers/contests.py withdraw_proposal."""

    contest: ContestOut | None = None
    placed_plans: list[PlanOut] = []


class ContestPicked(BaseModel):
    """What picking a set leaves behind: one placed plan per stop. The
    contest itself is gone — see routers/contests.py pick_set."""

    placed_plans: list[PlanOut]


# ---- The group splitting up (app/splits.py) ----


class SplitBranchIn(BaseModel):
    """One group, as a client describes it. `id` names an existing group
    when reshaping a split and is left out for a new one."""

    id: int | None = None
    label: str = Field(default="", max_length=200)
    traveler_ids: list[int] = Field(min_length=1)
    # The one group (at most) that people added to the trip later join.
    takes_newcomers: bool = False


class SplitCreate(BaseModel):
    """Split the group — POST /api/trips/{trip_id}/splits. Whatever is
    already planned in those hours goes to the group at index
    `keep_plans_with`; the others start with an empty calendar."""

    starts_at: datetime
    ends_at: datetime
    branches: list[SplitBranchIn] = Field(min_length=2)
    keep_plans_with: int = 0


class SplitUpdate(BaseModel):
    """Say who is in which group — PUT /api/splits/{split_id}. The whole
    assignment at once; see app/splits.py reshape_split."""

    branches: list[SplitBranchIn] = Field(min_length=2)


class SplitHours(BaseModel):
    """Change a split's hours — PUT /api/splits/{split_id}/hours. Nothing
    changes hands; see app/splits.py retime_split for what's refused."""

    starts_at: datetime
    ends_at: datetime


class SplitMerge(BaseModel):
    """Bring everyone back — POST /api/splits/{split_id}/merge. The kept
    group's plans become everyone's; the others' come off the calendar."""

    keep_branch_id: int


class SplitBranchOut(BaseModel):
    id: int
    label: str
    position: int
    traveler_ids: list[int]
    takes_newcomers: bool


class SplitOut(BaseModel):
    id: int
    trip_id: int
    starts_at: datetime
    ends_at: datetime
    branches: list[SplitBranchOut]


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
