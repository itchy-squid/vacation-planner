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
    # There is no traveller count any more: the people going are the
    # Traveler rows below, and how many there are is simply how many are
    # listed (see Traveler).
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    contributors: Mapped[list["Contributor"]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    pins: Mapped[list["Pin"]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    travel_items: Mapped[list["TravelItem"]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    plans: Mapped[list["Plan"]] = relationship(back_populates="trip", cascade="all, delete-orphan", foreign_keys="Plan.trip_id")
    contests: Mapped[list["Contest"]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    invites: Mapped[list["TripInvite"]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    splits: Mapped[list["Split"]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    travelers: Mapped[list["Traveler"]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="Traveler.position, Traveler.id"
    )


class Contributor(Base):
    """A trip member. `email` is matched against the Easy Auth principal at
    request time (see app/auth.py); there is no password/credential stored
    here.

    `role` is owner | planner | companion | reader, and it is the whole of what a
    member may do on this trip: app/permissions.py maps each role to a
    fixed set of scopes. A trip has exactly one owner, who is the person
    that created it."""

    __tablename__ = "contributors"
    __table_args__ = (
        UniqueConstraint("trip_id", "email", name="uq_contributor_trip_email"),
        CheckConstraint("role IN ('owner', 'planner', 'companion', 'reader')", name="ck_contributor_role"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"))
    email: Mapped[str] = mapped_column(String(320))
    display_name: Mapped[str] = mapped_column(String(120))
    initial: Mapped[str] = mapped_column(String(4))
    tint: Mapped[str] = mapped_column(String(32), default="var(--who-1)")
    role: Mapped[str] = mapped_column(String(16), default="planner")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # The link this person joined through, if any — what the owner's
    # "N joined" count on each invite link reads. Nulled, not cascaded, when
    # a link row is ever removed; revoking a link only stamps revoked_at.
    joined_via_invite_id: Mapped[int | None] = mapped_column(
        ForeignKey("trip_invites.id", ondelete="SET NULL", use_alter=True), nullable=True
    )

    trip: Mapped[Trip] = relationship(back_populates="contributors")

    def __init__(self, *, is_owner: bool | None = None, **kwargs):
        # Accepts the old is_owner flag so fixtures and seed code can keep
        # saying is_owner=True; role wins when both are given.
        if is_owner is not None and "role" not in kwargs:
            kwargs["role"] = "owner" if is_owner else "planner"
        super().__init__(**kwargs)

    @property
    def is_owner(self) -> bool:
        return self.role == "owner"


class Traveler(Base):
    """Someone going on the trip — which is a different question from
    who is on the app. Mei's nine-year-old and her mother are going and
    will never sign in; Priya is helping plan and isn't going. Members
    (Contributor) are who can see and change the trip; travelers are who
    the plan is for and who the costs are split between.

    - `contributor_id` links a traveler to the member who is them, when
      there is one. At most one traveler per member.
    - `paid_by_id` is the traveler who pays this one's costs, None for
      someone who pays their own. One level only: a traveler paid for by
      someone else can't pay for others (routers/travelers.py enforces it),
      so "what I'm paying" is always me plus the people pointing at me.

    SplitBranch.traveler_ids and Pin/TravelItem.heads hold traveler ids."""

    __tablename__ = "travelers"
    __table_args__ = (UniqueConstraint("trip_id", "contributor_id", name="uq_traveler_trip_contributor"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    initial: Mapped[str] = mapped_column(String(4))
    tint: Mapped[str] = mapped_column(String(32), default="var(--who-1)")
    contributor_id: Mapped[int | None] = mapped_column(ForeignKey("contributors.id", ondelete="SET NULL"), nullable=True)
    paid_by_id: Mapped[int | None] = mapped_column(ForeignKey("travelers.id", ondelete="SET NULL"), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    trip: Mapped[Trip] = relationship(back_populates="travelers")
    contributor: Mapped["Contributor | None"] = relationship()


class TripInvite(Base):
    """A shareable join link for one trip. Anyone signed in who opens it can
    add the trip to their list with `role`. One live link per role is
    reused (routers/sharing.py); a link works until the owner revokes it,
    which stamps revoked_at and leaves already-joined members alone."""

    __tablename__ = "trip_invites"
    __table_args__ = (CheckConstraint("role IN ('planner', 'companion', 'reader')", name="ck_trip_invite_role"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True)
    role: Mapped[str] = mapped_column(String(16))
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("contributors.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # A link made for one listed traveler ("Invite Grandma Hua"): whoever
    # accepts it becomes that traveler rather than a new one. Not one of
    # the per-role links — each is its own row, and it stops working once
    # the traveler is claimed.
    traveler_id: Mapped[int | None] = mapped_column(ForeignKey("travelers.id", ondelete="CASCADE"), nullable=True)

    trip: Mapped[Trip] = relationship(back_populates="invites")


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
    # What cost_cents means: "per_head" is what one person pays (the
    # default for anything new), "group" is one price for everyone sharing
    # it, like a van or a villa. Items from before per-person prices are
    # "group", so their totals didn't move. See app/derive.py item_money.
    cost_basis: Mapped[str] = mapped_column(String(16), default="per_head")
    # Which travelers share this cost. [] means whoever is on the plan it's
    # scheduled in: everyone, or the plan's group when the group has split
    # up (Split below).
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
    cost_basis: Mapped[str] = mapped_column(String(16), default="per_head")  # as Pin.cost_basis
    # Same meaning as Pin.heads above: the travelers sharing this cost,
    # empty meaning whoever is on the plan.
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


# Every status that holds real time on the calendar and so can collide with
# a placement. `draft` is deliberately absent: a private draft nobody else
# can see must never block anybody else (proposals-and-expenses spec §6.1).
OCCUPYING_STATUSES = (PlanStatus.placed, PlanStatus.pencilled, PlanStatus.contested, PlanStatus.locked)


class ContestStatus(str, enum.Enum):
    open = "open"
    resolved = "resolved"


class Plan(Base):
    """One scheduled placement of one or more pins/travel items onto a
    real starts_at/ends_at range. `contest_id` is set only once this plan
    is competing against at least one alternative (see Contest below);
    a plan with no contest_id is freely placed/pencilled/locked.

    Picking a set (routers/contests.py pick_set) replaces the whole contest
    with one plain placed plan per stop, so nothing new carries a
    contest_id once its decision is settled. Rows from before that change
    may still be `locked` with contest_id pointing at a `resolved` Contest;
    reopen_plan still handles those."""

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
    # Which group this plan is for when the group has split up (see Split
    # below). None is everyone. A plan in a branch lies inside its split's
    # hours; a plan for everyone never overlaps a split (app/splits.py).
    # SET NULL only matters for drafts: a branch is removed deliberately,
    # and every path that removes one deals with its placed plans first.
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("split_branches.id", ondelete="SET NULL"), nullable=True, index=True)
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
    branch: Mapped["SplitBranch | None"] = relationship()

    @property
    def title(self) -> str:
        """What a person would call this plan: its name, else its first
        stop. Used wherever a refusal has to say which plan is in the way."""
        if self.label:
            return self.label
        for item in self.items:
            source = item.pin or item.travel_item
            if source is not None:
                return source.title
        return "another plan"


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
    hours. Picking a set deletes the contest outright (routers/contests.py
    pick_set); `resolved`/`winning_plan_id` only appear on rows settled by
    the older lock-the-whole-window behaviour.

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
    # The group this decision is for, same meaning as Plan.branch_id. Every
    # option in the contest is in it, only its travelers vote, and the
    # majority is counted against them. None is the whole trip.
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("split_branches.id", ondelete="SET NULL"), nullable=True, index=True)
    winning_plan_id: Mapped[int | None] = mapped_column(ForeignKey("plans.id", use_alter=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    trip: Mapped[Trip] = relationship(back_populates="contests")
    plans: Mapped[list[Plan]] = relationship(back_populates="contest", cascade="all, delete-orphan", foreign_keys="Plan.contest_id")
    votes: Mapped[list["Vote"]] = relationship(back_populates="contest", cascade="all, delete-orphan")
    branch: Mapped["SplitBranch | None"] = relationship()


class Split(Base):
    """The group splitting up for a stretch of hours: Ana and Lin on the
    Taroko Gorge trail from 08:00 to 11:00 while everyone else bikes Liyu
    Lake. Its branches say who is in which group; plans and contests in
    those hours belong to one branch each.

    The rules that keep the calendar drawable (app/splits.py):
    - splits on one trip never overlap each other;
    - a plan in a branch lies inside its split's hours, and a plan for
      everyone never overlaps a split;
    - so two plans collide exactly when their hours overlap and they are
      for the same branch (or both for everyone).

    A split has at least two branches, and nobody is on two of them.
    Someone on no branch is allowed: they're doing their own thing."""

    __tablename__ = "splits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("contributors.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    trip: Mapped[Trip] = relationship(back_populates="splits")
    branches: Mapped[list["SplitBranch"]] = relationship(
        back_populates="split", cascade="all, delete-orphan", order_by="SplitBranch.position, SplitBranch.id"
    )


class SplitBranch(Base):
    """One group of a split. `traveler_ids` is exactly who is in it, and
    `takes_newcomers` marks the one branch (at most one per split) that a
    traveler added to the trip later joins — routers/travelers.py writes
    them onto it when they're added."""

    __tablename__ = "split_branches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    split_id: Mapped[int] = mapped_column(ForeignKey("splits.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(200), default="")
    position: Mapped[int] = mapped_column(Integer, default=0)
    traveler_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    takes_newcomers: Mapped[bool] = mapped_column(Boolean, default=False)

    split: Mapped[Split] = relationship(back_populates="branches")

    @property
    def trip_id(self) -> int:
        return self.split.trip_id

    def members(self, roster: set[int]) -> set[int]:
        """The travelers in this group who are still on the trip."""
        return set(self.traveler_ids or ()) & roster


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
