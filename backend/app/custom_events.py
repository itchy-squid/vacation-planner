"""Custom events live only as long as a plan holds them.

A custom event (a TravelItem — see models.py) is something someone typed
into the calendar or into a proposal: "scooter hire", "dinner with Lin's
cousin". Unlike a pin it isn't a place the group collected and might want
to schedule later, so once the plan holding it is gone there is nothing
for it to go back to. Leaving it in the unplaced list only makes people
delete it by hand. So whenever a plan is removed — unplaced from the
calendar, a draft discarded, a losing set forgotten at lock time, or a
stop dropped from a set — any custom event that no plan references any
more is deleted with it.

"Any plan" includes other people's drafts and other open sets: an event
still used somewhere else is left alone. Capture into an incumbent and
publishing a draft are not removals — the stops move to a new plan — and
don't call this.
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from .events import bus
from .models import PlanItem, TravelItem


def travel_item_ids_of(plans) -> set[int]:
    return {item.travel_item_id for plan in plans for item in plan.items if item.travel_item_id is not None}


def forget_orphaned_travel_items(db: Session, travel_item_ids: Iterable[int | None]) -> list[tuple[int, int]]:
    """Delete each of `travel_item_ids` that no PlanItem points at any more.
    Call after the plan (or plan items) have been deleted in this session;
    it flushes first so those deletions count. Returns (trip_id, id) pairs
    for `publish_forgotten` once the caller has committed."""
    ids = {i for i in travel_item_ids if i is not None}
    if not ids:
        return []
    db.flush()
    still_used = set(db.scalars(select(PlanItem.travel_item_id).where(PlanItem.travel_item_id.in_(ids))).all())
    removed: list[tuple[int, int]] = []
    for travel_item_id in sorted(ids - still_used):
        item = db.get(TravelItem, travel_item_id)
        if item is None:
            continue
        removed.append((item.trip_id, item.id))
        db.delete(item)
    return removed


def publish_forgotten(removed: list[tuple[int, int]]) -> None:
    for trip_id, travel_item_id in removed:
        bus.publish(trip_id, "travel_item.removed", {"travel_item_id": travel_item_id})
