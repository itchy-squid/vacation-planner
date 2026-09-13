"""Server-side derivation for plans — the backend equivalent of
frontend/src/data/derive.js. Nothing about a plan's totals is stored;
they're always computed from its items (see docs/features/
proposals-and-expenses-feature-spec.md §2, which amends the scheduling
spec's "Derived values").

There is no moving-time term here any more, and that is the point rather
than an omission. The old flat 12-minutes-per-hop estimate was one of three
different guesses at the same idea — the frontend's compare screen
sequenced stops 10 minutes apart, the itinerary screen 12 — so the same
three-stop day read as three different amounts of slack depending on which
screen you were looking at. A voter comparing two proposals has to be shown
the same number the compare screen will show them five seconds later, so
all three are now zero and every stop time comes from item_start below.
Real travel time (from the Google Maps Distance Matrix / Directions API —
see design_system/readme.md "Map provider") would be a genuine number per
pair of stops rather than a constant, and is still not wired up.
"""

from __future__ import annotations

from .models import Plan, PlanItem
from .tripclock import minutes_between


def item_duration_minutes(item: PlanItem) -> int:
    """The placement's own override if it has one, otherwise the pin's or
    travel item's own duration. A trim is local to the plan — see
    models.py PlanItem."""
    if item.duration_minutes is not None:
        return item.duration_minutes
    if item.pin_id is not None:
        return item.pin.duration_minutes
    return item.travel_item.duration_minutes


def item_cost_cents(item: PlanItem) -> int:
    """The whole cost of the underlying pin/travel item, for everyone
    sharing it. Never divided here: per-head is a display division, so the
    authoritative row total can't drift from the trip total (feature spec
    decision 3)."""
    if item.pin_id is not None:
        return item.pin.cost_cents
    return item.travel_item.cost_cents


def item_heads(item: PlanItem) -> list[int]:
    if item.pin_id is not None:
        return list(item.pin.heads or [])
    return list(item.travel_item.heads or [])


def item_start_minutes(plan: Plan, item: PlanItem) -> int:
    """Minutes from plan.starts_at. An explicit offset wins; otherwise the
    stops pack end to end in position order, which is what every plan the
    proposal flow builds looks like."""
    if item.offset_minutes is not None:
        return item.offset_minutes
    return sum(item_duration_minutes(other) for other in plan.items if other.position < item.position)


def plan_range_minutes(plan: Plan) -> int:
    return minutes_between(plan.ends_at, plan.starts_at)


def plan_totals(plan: Plan, range_minutes: int) -> dict[str, int]:
    total_duration = sum(item_duration_minutes(i) for i in plan.items)
    total_cost = sum(item_cost_cents(i) for i in plan.items)
    return {
        "total_duration_minutes": total_duration,
        "total_cost_cents": total_cost,
        "slack_minutes": range_minutes - total_duration,
    }
