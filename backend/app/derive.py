"""Server-side derivation for plans — the backend equivalent of
frontend/src/data/derive.js. Nothing about a plan's totals is stored;
they're always computed from its items (see docs/features/
scheduling-feature-spec.md "Derived values").

Moving time is a flat per-hop estimate here, same as the frontend's
client-side sequencing. Real travel time (and the specific
20/6/12-minute prototype numbers) comes from the Google Maps Distance
Matrix / Directions API — see design_system/readme.md "Map provider" —
which is not wired up in this pass.
"""

from __future__ import annotations

from .models import Plan, PlanItem

MINUTES_PER_HOP_ESTIMATE = 12


def moving_minutes(item_count: int) -> int:
    return max(0, (item_count - 1) * MINUTES_PER_HOP_ESTIMATE)


def _item_duration_minutes(item: PlanItem) -> int:
    if item.pin_id is not None:
        return item.pin.duration_minutes
    return item.travel_item.duration_minutes


def _item_cost_cents(item: PlanItem) -> int:
    if item.pin_id is not None:
        return item.pin.cost_cents
    return item.travel_item.cost_cents


def plan_range_minutes(plan: Plan) -> int:
    return int((plan.ends_at - plan.starts_at).total_seconds() // 60)


def plan_totals(plan: Plan, range_minutes: int) -> dict[str, int]:
    total_duration = sum(_item_duration_minutes(i) for i in plan.items)
    total_cost = sum(_item_cost_cents(i) for i in plan.items)
    moving = moving_minutes(len(plan.items))
    slack = range_minutes - total_duration - moving
    return {
        "total_duration_minutes": total_duration,
        "total_cost_cents": total_cost,
        "moving_minutes": moving,
        "slack_minutes": slack,
    }
