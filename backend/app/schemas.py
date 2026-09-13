"""Pydantic request/response models. Kept close to the ORM shape in
models.py; this is the contract the frontend's API client targets (see
frontend/src/lib/api.js)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from . import photo_storage


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
    is_owner: bool


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
    created_at: datetime


class TripUpdate(BaseModel):
    """PATCH /api/trips/{id} — see app/routers/trips.py::update_trip.
    Unset fields are left alone (exclude_unset), same pattern as PinUpdate
    below."""

    name: str | None = None
    region_line: str | None = None
    start_date: date | None = None
    end_date: date | None = None


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
    duration_minutes: int | None = None
    cost_cents: int | None = None
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
    cost_cents: int
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


class AvailabilityOverrideToggle(BaseModel):
    day: int
    band: str


TravelItemKind = Literal["flight", "train", "drive", "lodging", "other"]


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
    notes: str | None = None
    link: str | None = None


class TravelItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    trip_id: int
    title: str
    kind: str
    duration_minutes: int
    cost_cents: int
    notes: str
    link: str
    added_by_id: int | None
    added_at: datetime


class PlanItemCreate(BaseModel):
    pin_id: int | None = None
    travel_item_id: int | None = None

    @model_validator(mode="after")
    def _exactly_one_target(self) -> "PlanItemCreate":
        if (self.pin_id is None) == (self.travel_item_id is None):
            raise ValueError("Exactly one of pin_id or travel_item_id must be set")
        return self


class PlanItemOut(BaseModel):
    pin: PinOut | None = None
    travel_item: TravelItemOut | None = None
    position: int


PlanStatusLiteral = Literal["placed", "pencilled", "contested", "locked"]


class PlanCreate(BaseModel):
    """Direct placement — POST /api/trips/{trip_id}/plans. `status` is
    restricted to placed/pencilled here: contested/locked plans only ever
    come out of the propose-alternative and lock flows (see
    routers/contests.py), never straight from a client-supplied status."""

    starts_at: datetime
    ends_at: datetime
    status: Literal["placed", "pencilled"] = "placed"
    items: list[PlanItemCreate] = Field(default_factory=list)


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
    items: list[PlanItemOut]
    # Derived, never stored — see app/derive.py.
    total_duration_minutes: int
    total_cost_cents: int
    moving_minutes: int
    slack_minutes: int


class ContestProposeCreate(BaseModel):
    against_plan_id: int
    starts_at: datetime
    ends_at: datetime
    items: list[PlanItemCreate] = Field(default_factory=list)


class ContestPlanOut(PlanOut):
    vote_count: int
    voted_by_me: bool


class ContestOut(BaseModel):
    id: int
    trip_id: int
    status: Literal["open", "resolved"]
    winning_plan_id: int | None
    plans: list[ContestPlanOut]
    voted_count: int
    contributor_count: int
    # Which plan the requesting principal has voted for in this contest, if
    # any — lets the frontend show "Voted ✓" without a separate lookup. See
    # app/routers/contests.py::_contest_to_schema.
    my_vote_plan_id: int | None = None


class VoteToggle(BaseModel):
    plan_id: int


class LockRequest(BaseModel):
    plan_id: int


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
