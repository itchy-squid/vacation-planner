"""Pydantic request/response models. Kept close to the ORM shape in
models.py; this is the contract the frontend's API client will target once
it moves off mock data (see root README "Next steps")."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class ContributorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
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
    id: str
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


class PinUpdate(BaseModel):
    title: str | None = None
    duration_minutes: int | None = None
    cost_cents: int | None = None
    notes: str | None = None
    link: str | None = None
    tags: list[str] | None = None


class PinOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    trip_id: str
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
    added_by_id: str | None
    added_at: datetime
    # Included so the frontend can render the availability grid straight off
    # the pin fetch (list or detail) without a second round trip — see
    # app/routers/pins.py for how these are written.
    availability_rule: "AvailabilityRuleOut | None" = None
    availability_overrides: list[AvailabilityOverrideOut] = Field(default_factory=list)


class AvailabilityOverrideToggle(BaseModel):
    day: int
    band: str


class CandidateSetStopOut(BaseModel):
    pin: PinOut
    position: int


class CandidateSetOut(BaseModel):
    id: str
    key: str
    label: str
    color: str
    is_draft: bool
    stops: list[CandidateSetStopOut]
    vote_count: int
    # Derived, never stored — see handoff README "State management":
    total_duration_minutes: int
    total_cost_cents: int
    moving_minutes: int
    slack_minutes: int


class BlockOut(BaseModel):
    id: str
    trip_id: str
    day_index: int
    start_minute: int
    end_minute: int
    region: str
    status: str
    locked_set_id: str | None
    candidate_sets: list[CandidateSetOut]
    voted_count: int
    contributor_count: int
    # Which set the requesting principal has voted for on this block, if any
    # — lets the frontend show "Voted ✓" without a separate lookup. See
    # app/routers/blocks.py::_block_to_schema.
    my_vote_candidate_set_id: str | None = None


class VoteToggle(BaseModel):
    candidate_set_id: str


class LockRequest(BaseModel):
    candidate_set_id: str


class CommentCreate(BaseModel):
    body: str
    pin_id: str | None = None
    candidate_set_id: str | None = None


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    body: str
    contributor_id: str
    pin_id: str | None
    candidate_set_id: str | None
    created_at: datetime
