"""Durations, starts, slack and cost.

One definition each, shared by every screen — see app/derive.py's module
docstring for why there used to be three.
"""

from app.derive import (
    item_cost_cents,
    item_duration_minutes,
    item_money,
    item_start_minutes,
    plan_range_minutes,
    plan_totals,
)
from app.models import PlanItem, PlanStatus

from conftest import as_user, at


def totals(plan):
    return plan_totals(plan, plan_range_minutes(plan))


def test_slack_is_the_window_minus_the_stops(trip):
    # 13:00-18:00 with a 50m and a 30m stop.
    plan = trip.place(start=780, end=1080, items=[("vase", None), ("ice", None)])
    assert totals(plan) == {
        "total_duration_minutes": 80,
        "total_cost_cents": 400,
        # No moving-time term: 300 - 80, not 300 - 80 - 12.
        "slack_minutes": 220,
    }


def test_an_override_shortens_the_placement_and_not_the_pin(trip, db):
    plan = trip.place(start=780, end=1080, items=[("trail", 60)])  # an 80m pin
    item = plan.items[0]

    assert item_duration_minutes(item) == 60
    assert trip.pins["trail"].duration_minutes == 80
    assert totals(plan)["total_duration_minutes"] == 60


def test_stops_pack_end_to_end_in_position_order(trip):
    plan = trip.place(start=780, end=1080, items=[("vase", None), ("ice", None), ("cave", None)])
    starts = [item_start_minutes(plan, i) for i in plan.items]
    # 50m, then 30m, then 45m — each starting where the last ended.
    assert starts == [0, 50, 80]


def test_packing_respects_the_overrides_before_it(trip):
    plan = trip.place(start=780, end=1080, items=[("vase", 90), ("ice", None)])
    assert [item_start_minutes(plan, i) for i in plan.items] == [0, 90]


def test_an_explicit_offset_wins_over_packing(trip, db):
    plan = trip.place(start=780, end=1080, items=[("vase", None), ("ice", None)])
    plan.items[1].offset_minutes = 180
    db.commit()
    db.refresh(plan)

    assert [item_start_minutes(plan, i) for i in plan.items] == [0, 180]
    # An offset moves a stop; it doesn't change how long the stop is, so
    # the plan's total duration is untouched.
    assert totals(plan)["total_duration_minutes"] == 80


def test_a_plans_cost_is_the_sum_of_its_stops(trip):
    plan = trip.place(start=780, end=1080, items=[("tide", None), ("ice", None)])

    assert item_cost_cents(plan.items[0]) == 500
    assert totals(plan)["total_cost_cents"] == 900


def test_per_head_rounding_never_moves_the_trip_total(trip, db):
    """The Expenses screen divides for display. Four people splitting a
    $10.01 group price each see $2.50, and 4 x 250 is 1000 — which is why
    the row total and the trip total both come from cost_cents, not from
    the division."""
    trip.pins["tide"].cost_cents = 1001
    trip.pins["tide"].cost_basis = "group"
    db.commit()
    plan = trip.place(start=780, end=1080, items=[("tide", None)])

    sharers, each, total = item_money(plan, plan.items[0])
    assert len(sharers) == 4
    assert each * len(sharers) != total == 1001
    assert totals(plan)["total_cost_cents"] == 1001


def test_start_minute_of_day_is_served_precomputed(client, trip):
    """So the Expenses page and the compare/itinerary stop lists don't each
    re-derive packing."""
    trip.place(start=840, end=1080, items=[("vase", None), ("ice", None)], status=PlanStatus.placed)

    plans = client.get(f"/api/trips/{trip.id}/plans", headers=as_user("mei@example.com")).json()
    items = plans[0]["items"]
    assert [i["start_minute_of_day"] for i in items] == [840, 890]  # 14:00, 14:50


def test_a_plan_carries_no_moving_minutes(client, trip):
    trip.place(start=780, end=1080, items=[("vase", None), ("ice", None)])
    plan = client.get(f"/api/trips/{trip.id}/plans", headers=as_user("mei@example.com")).json()[0]
    assert "moving_minutes" not in plan
    assert plan["slack_minutes"] == 220


def test_a_plan_spanning_midnight_still_reads_a_wall_clock_time(trip):
    """start_minute_of_day wraps rather than running past 24:00 — the grid
    only has 1440 minutes in it."""
    plan = trip.place(start=1380, end=1440, items=[("ice", None)])  # 23:00
    assert item_start_minutes(plan, plan.items[0]) == 0
    assert isinstance(plan.items[0], PlanItem)
    assert at(1, 1380).hour == 23
