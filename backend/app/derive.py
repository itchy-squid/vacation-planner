"""Server-side derivation for candidate sets — the backend equivalent of
frontend/src/data/derive.js. Nothing about a set's totals is stored; they're
always computed from its stops (handoff README "Derived, never stored").

Moving time is a flat per-hop estimate here, same as the frontend's Set C
draft calculation. Real travel time (and the specific 20/6/12-minute
prototype numbers) comes from the Google Maps Distance Matrix / Directions
API — see design_system/readme.md "Map provider" — which is not wired up
in this pass.
"""

from __future__ import annotations

from .models import CandidateSet

MINUTES_PER_HOP_ESTIMATE = 12


def moving_minutes(stop_count: int) -> int:
    return max(0, (stop_count - 1) * MINUTES_PER_HOP_ESTIMATE)


def candidate_set_totals(candidate_set: CandidateSet, block_minutes: int) -> dict[str, int]:
    stops = [s.pin for s in candidate_set.stops]
    total_duration = sum(p.duration_minutes for p in stops)
    total_cost = sum(p.cost_cents for p in stops)
    moving = moving_minutes(len(stops))
    slack = block_minutes - total_duration - moving
    return {
        "total_duration_minutes": total_duration,
        "total_cost_cents": total_cost,
        "moving_minutes": moving,
        "slack_minutes": slack,
    }
