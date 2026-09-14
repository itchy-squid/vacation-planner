"""SQLAlchemy models for the vacation planner.

This schema is deliberately more normalized than the design prototype's flat
in-memory state (see the design handoff README "State management") because
it needs to support real multi-user data: candidate sets are rows a group
can create at will (not just fixed keys "A"/"B"), votes are per-contributor
records, and availability is derived from a rule plus explicit overrides.

Every id is a plain autoincrementing integer, not a UUID — the app builds
shareable URLs straight out of these ids (see the frontend's
state/PlannerContext.jsx and App.jsx), and short integers keep those links
readable. Nothing here is exposed in a way that depends on ids being
unguessable, so there's no security tradeoff in dropping UUIDs.

Scheduling model (Plan/PlanItem/Contest/Vote/TravelItem — see
docs/features/scheduling-feature-spec.md) replaces an earlier
Block/CandidateSet design: instead of pre-carved fixed-length "blocks" on a
day with pre-seeded candidate groupings, contributors place pins and
TravelItems directly onto a real starts_at/ends_at range; a conflict is
resolved by proposing competing Plans against each other (a Contest) rather
than always having exactly two pre-existing options.
"""

from __future__ import annotations

import enum
from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
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


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TripPhase(str, enum.Enum):
    ideation = "ideation"
    scheduling = "scheduling"
    locked = "locked"


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
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
    # How many people the trip is *costed* for, which is not the same
    # question as how many people are planning it: a couple sharing one
    # cabin plans as two contributors but a child along for the ride is a
    # head the tickets are bought for and never a contributor. NULL falls
    # back to len(contributors) — see app/routers/plans.py and the
    # frontend's Expenses screen, which both go through that same fallback.
    traveller_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    contributors: Mapped[list["Contributor"]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    pins: Mapped[list["Pin"]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    travel_items: Mapped[list["TravelItem"]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    plans: Mapped[list["Plan"]] = relationship(back_populates="trip", cascade="all, delete-orphan", foreign_keys="Plan.trip_id")
    contests: Mapped[list["Contest"]] = relationship(back_populates="trip", cascade="all, delete-orphan")


class Contributor(Base):
    """A trip member. `email` is matched against the Easy Auth principal at
    request time (see app/auth.py) once real auth is wired up; there is no
    password/credential stored here."""

    __tablename__ = "contributors"
    __table_args__ = (UniqueConstraint("trip_id", "email", name="uq_contributor_trip_email"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"))
    email: Mapped[str] = mapped_column(String(320))
    display_name: Mapped[str] = mapped_column(String(120))
    initial: Mapped[str] = mapped_column(String(4))
    tint: Mapped[str] = mapped_column(String(32), default="var(--who-1)")
    is_owner: Mapped[bool] = mapped_column(Boolean, default=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    trip: Mapped[Trip] = relationship(back_populates="contributors")


class Pin(Base):
    __tablename__ = "pins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    short: Mapped[str] = mapped_column(String(60))
    place: Mapped[str] = mapped_column(String(200))
    region: Mapped[str] = mapped_column(String(120))

    # Real geocoding is not wired up yet (see design_system readme "Map
    # provider"); lat/lng are nullable until the pin has been geocoded.
    lat: Mapped[float | None] = mapped_column(nullable=True)
    lng: Mapped[float | None] = mapped_column(nullable=True)

    duration_minutes: Mapped[int] = mapped_column(Integer, default=60)
    # The whole cost of visiting this pin, for everyone it's shared
    # between — never a per-person price. Per-head is a display division
    # (cost_cents / headcount), so rounding can never accumulate into a
    # wrong trip total; see docs/features/proposals-and-expenses-feature-
    # spec.md decision 3.
    cost_cents: Mapped[int] = mapped_column(Integer, default=0)
    # Which contributors share cost_cents. [] means "everyone on the trip",
    # which is the common case and is why it's the default rather than a
    # list of every contributor id (which would go stale the moment someone
    # joined). Headcount for an empty list is Trip.traveller_count.
    heads: Mapped[list[int]] = mapped_column(JSON, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str] = mapped_column(String(500), default="")
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)

    # Photo picker flow is not designed yet (handoff README "Photography —
    # planned behaviour"); these stay null and the frontend falls back to
    # the striped placeholder.
    photo_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    photo_source_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    added_by_id: Mapped[int | None] = mapped_column(ForeignKey("contributors.id"), nullable=True)
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pin_id: Mapped[int] = mapped_column(ForeignKey("pins.id", ondelete="CASCADE"), unique=True)
    days: Mapped[list[int]] = mapped_column(JSON, default=list)
    bands: Mapped[list[str]] = mapped_column(JSON, default=list)
    reasons: Mapped[list[str]] = mapped_column(JSON, default=list)

    pin: Mapped[Pin] = relationship(back_populates="availability_rule")


class AvailabilityOverride(Base):
    __tablename__ = "availability_overrides"
    __table_args__ = (UniqueConstraint("pin_id", "day", "band", name="uq_override_pin_day_band"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pin_id: Mapped[int] = mapped_column(ForeignKey("pins.id", ondelete="CASCADE"))
    day: Mapped[int] = mapped_column(Integer)
    band: Mapped[str] = mapped_column(String(8))
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("contributors.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    pin: Mapped[Pin] = relationship(back_populates="availability_overrides")


class TravelItem(Base):
    """A logistics leg — a journey, a lodging stay, or anything else on the
    schedule that isn't a Pin (a place to visit). Not tied to any
    particular day until it's placed into a Plan; `kind` is a free string
    (not a DB enum) since the spec's own set of suggested values
    ("travel"/"lodging"/"other") is a UI affordance, not a hard constraint
    — see schemas.py TravelItemKind for where that set is validated, and
    for why the old flight/train/drive split collapsed into "travel"."""

    __tablename__ = "travel_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20), default="other")
    duration_minutes: Mapped[int] = mapped_column(Integer, default=60)
    cost_cents: Mapped[int] = mapped_column(Integer, default=0)
    # Same meaning as Pin.heads above: the contributors sharing this cost,
    # empty meaning everyone.
    heads: Mapped[list[int]] = mapped_column(JSON, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str] = mapped_column(String(500), default="")
    added_by_id: Mapped[int | None] = mapped_column(ForeignKey("contributors.id"), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    trip: Mapped[Trip] = relationship(back_populates="travel_items")
    added_by: Mapped[Contributor | None] = relationship()


class PlanStatus(str, enum.Enum):
    # Author-visible only, and deliberately *not* occupying: a private
    # draft never blocks anyone else's placement, never appears on another
    # contributor's calendar, and never reaches the trip's event channel.
    # See docs/features/proposals-and-expenses-feature-spec.md §6.4 and
    # routers/plans.py's visible_plans_condition, which is the one place
    # the read filter lives.
    draft = "draft"
    placed = "placed"
    pencilled = "pencilled"
    contested = "contested"
    locked = "locked"


class ContestStatus(str, enum.Enum):
    open = "open"
    resolved = "resolved"


class Plan(Base):
    """One scheduled placement of one or more pins/travel items onto a
    real starts_at/ends_at range. `contest_id` is set only once this plan
    is competing against at least one alternative (see Contest below);
    a plan with no contest_id is either freely placed/pencilled, or is a
    `locked` plan that "won" its contest (locking clears its siblings —
    see routers/contests.py lock_contest — but the winning plan itself
    keeps contest_id pointing at the now-resolved Contest, since
    Contest.winning_plan_id needs the reverse lookup too)."""

    __tablename__ = "plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    label: Mapped[str] = mapped_column(String(200), default="")
    color: Mapped[str] = mapped_column(String(32), default="var(--accent)")
    # The proposer's case for this plan, shown to voters on the compare
    # screen ("Why (optional)" in the proposal flow's review step). Empty
    # for every plan that wasn't proposed through that flow.
    rationale: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[PlanStatus] = mapped_column(Enum(PlanStatus), default=PlanStatus.placed)
    # Circular with Contest.winning_plan_id (a Contest is created only after
    # a Plan already exists to contest against) — use_alter, same pattern as
    # the old Block.locked_set_id -> CandidateSet.id FK it replaces.
    contest_id: Mapped[int | None] = mapped_column(ForeignKey("contests.id", use_alter=True, ondelete="CASCADE"), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("contributors.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    trip: Mapped[Trip] = relationship(back_populates="plans", foreign_keys=[trip_id])
    items: Mapped[list["PlanItem"]] = relationship(back_populates="plan", cascade="all, delete-orphan", order_by="PlanItem.position")
    contest: Mapped["Contest | None"] = relationship(back_populates="plans", foreign_keys=[contest_id])
    created_by: Mapped[Contributor | None] = relationship()
    votes: Mapped[list["Vote"]] = relationship(back_populates="plan", cascade="all, delete-orphan")


class PlanItem(Base):
    """One pin or travel item within a plan. Deleting a PlanItem never
    deletes the Pin/TravelItem it points to — only the placement row.

    `duration_minutes` and `offset_minutes` are both overrides, both
    nullable, and both local to this placement — the Pin/TravelItem behind
    them is never touched, so trimming a stop in one proposal can't shorten
    the same pin somewhere else on the calendar. See app/derive.py, which
    is the only place that resolves either of them."""

    __tablename__ = "plan_items"
    __table_args__ = (
        CheckConstraint(
            "(pin_id IS NOT NULL) != (travel_item_id IS NOT NULL)",
            name="ck_plan_item_exactly_one_target",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"))
    pin_id: Mapped[int | None] = mapped_column(ForeignKey("pins.id"), nullable=True)
    travel_item_id: Mapped[int | None] = mapped_column(ForeignKey("travel_items.id"), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    # NULL = read the duration off the pin/travel item. Set only when this
    # placement is deliberately shorter (or longer) than the item's own
    # duration — the proposal flow's "SHORTENED FROM 3H".
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Start, in minutes from plan.starts_at. NULL = packed end to end in
    # position order, which is what a plan built by the proposal flow
    # always is. Set explicitly when several plans are captured into one
    # incumbent option (routers/contests.py) so the captured stops keep
    # their real clock times inside the wider window instead of sliding to
    # its start.
    offset_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    plan: Mapped[Plan] = relationship(back_populates="items")
    pin: Mapped[Pin | None] = relationship()
    travel_item: Mapped[TravelItem | None] = relationship()


class Contest(Base):
    """Created on demand when an alternative is proposed for a range of
    hours. `winning_plan_id` is set only on resolution (locking) — see
    routers/contests.py.

    The contest owns the window, not its plans: `starts_at`/`ends_at` are
    the hours being decided, and every option in the contest spans exactly
    those hours. That's what makes locking safe — everything that was in
    those hours was captured into an option, so there's nothing left
    outside the contest to collide with the winner. See docs/features/
    proposals-and-expenses-feature-spec.md decision 1."""

    __tablename__ = "contests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[ContestStatus] = mapped_column(Enum(ContestStatus), default=ContestStatus.open)
    winning_plan_id: Mapped[int | None] = mapped_column(ForeignKey("plans.id", use_alter=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    trip: Mapped[Trip] = relationship(back_populates="contests")
    plans: Mapped[list[Plan]] = relationship(back_populates="contest", cascade="all, delete-orphan", foreign_keys="Plan.contest_id")
    votes: Mapped[list["Vote"]] = relationship(back_populates="contest", cascade="all, delete-orphan")


class Vote(Base):
    """One vote per contributor per contest — toggleable, and switching
    plans within a contest replaces the row rather than adding a second
    one (see docs/features/scheduling-feature-spec.md "Voting")."""

    __tablename__ = "votes"
    __table_args__ = (UniqueConstraint("contest_id", "contributor_id", name="uq_vote_contest_contributor"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    contest_id: Mapped[int] = mapped_column(ForeignKey("contests.id", ondelete="CASCADE"))
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"))
    contributor_id: Mapped[int] = mapped_column(ForeignKey("contributors.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    contest: Mapped[Contest] = relationship(back_populates="votes")
    plan: Mapped[Plan] = relationship(back_populates="votes")


class Comment(Base):
    """Attributed to a person, per design_system readme ("Group software
    works when you can see who said what"). Threading is not designed yet
    (handoff README "Not yet designed") — comments are a flat list.
    Attaches to either a pin or a plan, via pin_id / plan_id."""

    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pin_id: Mapped[int | None] = mapped_column(ForeignKey("pins.id", ondelete="CASCADE"), nullable=True)
    plan_id: Mapped[int | None] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"), nullable=True)
    contributor_id: Mapped[int] = mapped_column(ForeignKey("contributors.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
