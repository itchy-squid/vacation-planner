"""SQLAlchemy models for the vacation planner.

This schema is deliberately more normalized than the design prototype's flat
in-memory state (see the design handoff README "State management") because
it needs to support real multi-user data: candidate sets are rows a group
can create at will (not just fixed keys "A"/"B"), votes are per-contributor
records, and availability is derived from a rule plus explicit overrides.

Nothing here is wired to the frontend yet (this pass ships the UI against
mock data — see root README "Next steps"); this is the schema the next pass
connects to.
"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TripPhase(str, enum.Enum):
    ideation = "ideation"
    scheduling = "scheduling"
    locked = "locked"


class BlockStatus(str, enum.Enum):
    empty = "empty"
    pencilled = "pencilled"
    placed = "placed"
    contested = "contested"
    locked = "locked"


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200))
    region_line: Mapped[str] = mapped_column(String(300), default="")
    # Structured so schedule/availability screens could eventually compute
    # real calendar dates from them — see frontend/src/data/trip.js, which
    # deliberately does NOT do that yet (Day labels stay hand-authored
    # relative numbers; only the trip's own display line derives from
    # these — see frontend/src/lib/format.js formatDateRange).
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    phase: Mapped[TripPhase] = mapped_column(Enum(TripPhase), default=TripPhase.ideation)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    contributors: Mapped[list["Contributor"]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    pins: Mapped[list["Pin"]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    blocks: Mapped[list["Block"]] = relationship(back_populates="trip", cascade="all, delete-orphan")


class Contributor(Base):
    """A trip member. `email` is matched against the Easy Auth principal at
    request time (see app/auth.py) once real auth is wired up; there is no
    password/credential stored here."""

    __tablename__ = "contributors"
    __table_args__ = (UniqueConstraint("trip_id", "email", name="uq_contributor_trip_email"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"))
    email: Mapped[str] = mapped_column(String(320))
    display_name: Mapped[str] = mapped_column(String(120))
    initial: Mapped[str] = mapped_column(String(4))
    tint: Mapped[str] = mapped_column(String(32), default="var(--who-1)")
    is_owner: Mapped[bool] = mapped_column(Boolean, default=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    trip: Mapped[Trip] = relationship(back_populates="contributors")


class Pin(Base):
    __tablename__ = "pins"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    short: Mapped[str] = mapped_column(String(60))
    place: Mapped[str] = mapped_column(String(200))
    region: Mapped[str] = mapped_column(String(120))

    # Real geocoding is not wired up yet (see design_system readme "Map
    # provider"); lat/lng are nullable until the pin has been geocoded.
    lat: Mapped[float | None] = mapped_column(nullable=True)
    lng: Mapped[float | None] = mapped_column(nullable=True)

    duration_minutes: Mapped[int] = mapped_column(Integer, default=60)
    cost_cents: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str] = mapped_column(String(500), default="")
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)

    # Photo picker flow is not designed yet (handoff README "Photography —
    # planned behaviour"); these stay null and the frontend falls back to
    # the striped placeholder.
    photo_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    photo_source_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    added_by_id: Mapped[str | None] = mapped_column(ForeignKey("contributors.id"), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    trip: Mapped[Trip] = relationship(back_populates="pins")
    added_by: Mapped[Contributor | None] = relationship()
    availability_rule: Mapped["AvailabilityRule | None"] = relationship(back_populates="pin", uselist=False, cascade="all, delete-orphan")
    availability_overrides: Mapped[list["AvailabilityOverride"]] = relationship(back_populates="pin", cascade="all, delete-orphan")


class AvailabilityRule(Base):
    """At most one base rule per pin. `days`/`bands` are the trip-day
    numbers and AM/PM/EVE bands the pin is available in; `reasons` are shown
    to the group alongside the hatched cells (never assert a restriction
    without explaining it — design_system readme "Content fundamentals")."""

    __tablename__ = "availability_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    pin_id: Mapped[str] = mapped_column(ForeignKey("pins.id", ondelete="CASCADE"), unique=True)
    days: Mapped[list[int]] = mapped_column(JSON, default=list)
    bands: Mapped[list[str]] = mapped_column(JSON, default=list)
    reasons: Mapped[list[str]] = mapped_column(JSON, default=list)

    pin: Mapped[Pin] = relationship(back_populates="availability_rule")


class AvailabilityOverride(Base):
    __tablename__ = "availability_overrides"
    __table_args__ = (UniqueConstraint("pin_id", "day", "band", name="uq_override_pin_day_band"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    pin_id: Mapped[str] = mapped_column(ForeignKey("pins.id", ondelete="CASCADE"))
    day: Mapped[int] = mapped_column(Integer)
    band: Mapped[str] = mapped_column(String(8))
    created_by_id: Mapped[str | None] = mapped_column(ForeignKey("contributors.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    pin: Mapped[Pin] = relationship(back_populates="availability_overrides")


class Block(Base):
    """A free-length slot on a day's timeline. When more than one
    CandidateSet exists for a block, status is "contested" and the compare
    screen is how the group resolves it (handoff README screen 4/5)."""

    __tablename__ = "blocks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"))
    day_index: Mapped[int] = mapped_column(Integer)
    start_minute: Mapped[int] = mapped_column(Integer)
    end_minute: Mapped[int] = mapped_column(Integer)
    region: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[BlockStatus] = mapped_column(Enum(BlockStatus), default=BlockStatus.empty)
    locked_set_id: Mapped[str | None] = mapped_column(ForeignKey("candidate_sets.id", use_alter=True), nullable=True)

    trip: Mapped[Trip] = relationship(back_populates="blocks")
    candidate_sets: Mapped[list["CandidateSet"]] = relationship(
        back_populates="block", cascade="all, delete-orphan", foreign_keys="CandidateSet.block_id"
    )


class CandidateSet(Base):
    """One candidate grouping of stops for a block. `is_draft` marks a
    single contributor's in-progress set (the prototype's "Set C" pattern);
    non-draft sets are pre-seeded/curated candidates any contributor can
    vote on."""

    __tablename__ = "candidate_sets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    block_id: Mapped[str] = mapped_column(ForeignKey("blocks.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(8))
    label: Mapped[str] = mapped_column(String(120), default="")
    color: Mapped[str] = mapped_column(String(32), default="var(--accent)")
    is_draft: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by_id: Mapped[str | None] = mapped_column(ForeignKey("contributors.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    block: Mapped[Block] = relationship(back_populates="candidate_sets", foreign_keys=[block_id])
    stops: Mapped[list["CandidateSetStop"]] = relationship(
        back_populates="candidate_set", cascade="all, delete-orphan", order_by="CandidateSetStop.position"
    )
    votes: Mapped[list["Vote"]] = relationship(back_populates="candidate_set", cascade="all, delete-orphan")


class CandidateSetStop(Base):
    __tablename__ = "candidate_set_stops"
    __table_args__ = (UniqueConstraint("candidate_set_id", "pin_id", name="uq_set_stop_pin"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    candidate_set_id: Mapped[str] = mapped_column(ForeignKey("candidate_sets.id", ondelete="CASCADE"))
    pin_id: Mapped[str] = mapped_column(ForeignKey("pins.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer, default=0)

    candidate_set: Mapped[CandidateSet] = relationship(back_populates="stops")
    pin: Mapped[Pin] = relationship()


class Vote(Base):
    """One vote per contributor per block — toggleable, and switching sets
    within a block replaces the row rather than adding a second one (see
    handoff README "Interactions & behaviour → Voting")."""

    __tablename__ = "votes"
    __table_args__ = (UniqueConstraint("block_id", "contributor_id", name="uq_vote_block_contributor"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    block_id: Mapped[str] = mapped_column(ForeignKey("blocks.id", ondelete="CASCADE"))
    candidate_set_id: Mapped[str] = mapped_column(ForeignKey("candidate_sets.id", ondelete="CASCADE"))
    contributor_id: Mapped[str] = mapped_column(ForeignKey("contributors.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    candidate_set: Mapped[CandidateSet] = relationship(back_populates="votes")


class Comment(Base):
    """Attributed to a person, per design_system readme ("Group software
    works when you can see who said what"). Threading is not designed yet
    (handoff README "Not yet designed") — comments are a flat list."""

    __tablename__ = "comments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    pin_id: Mapped[str | None] = mapped_column(ForeignKey("pins.id", ondelete="CASCADE"), nullable=True)
    candidate_set_id: Mapped[str | None] = mapped_column(ForeignKey("candidate_sets.id", ondelete="CASCADE"), nullable=True)
    contributor_id: Mapped[str] = mapped_column(ForeignKey("contributors.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
