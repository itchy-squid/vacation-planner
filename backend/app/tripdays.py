"""Days of the trip, and moving a trip's dates.

Everything on a trip's calendar is stored relative to the trip, not to the
calendar: a place to stay is on day 3 (TripDayPlace.day, 1 is the first
day), a plan runs from minute 2 * 1440 + 540 to 2 * 1440 + 660 (09:00 to
11:00 on day 3; Plan/Contest/Split.start_min and end_min count from 00:00
on day 1). The trip's start_date says which real date day 1 is, if it's
known yet; a trip planned before that has a length instead
(Trip.length_days). Times are wall-clock time wherever the trip is, so
there's no timezone to get wrong.

So moving a trip's dates moves its whole plan with it for free. Keeping
things on the dates they were on instead ("keep_dates") is the one
operation that rewrites rows: every day number moves back by however many
days the start moved (move_calendar)."""

from __future__ import annotations

from datetime import date

from sqlalchemy import exists, select, update
from sqlalchemy.orm import Session

from .models import AvailabilityOverride, AvailabilityRule, Contest, Pin, Plan, Split, Trip, TripDayPlace

MINUTES_PER_DAY = 1440
# Far past any trip's length, so stepping every row through it first can't
# land one on a day another row still holds (see _shift_days).
_PARK = 1_000_000


def day_count(trip: Trip) -> int | None:
    """How many days the trip has: from its dates, else its planned
    length; None when it has neither."""
    if trip.start_date is not None:
        end = trip.end_date or trip.start_date
        return max(1, (end - trip.start_date).days + 1)
    return trip.length_days


def clock(minute: int) -> str:
    """"09:30" for a trip minute, whatever day it's on."""
    within = minute % MINUTES_PER_DAY
    return f"{within // 60:02d}:{within % 60:02d}"


def has_calendar(db: Session, trip_id: int) -> bool:
    """Whether anything is on the trip's calendar that moving its start
    date would move: plans (drafts too), splits, places for a day, or an
    idea's own first and last day."""
    checks = (
        exists().where(Plan.trip_id == trip_id),
        exists().where(Split.trip_id == trip_id),
        exists().where(TripDayPlace.trip_id == trip_id),
        exists().where(Pin.trip_id == trip_id, Pin.cost_start_day.is_not(None)),
    )
    return any(db.scalar(select(check)) for check in checks)


def start_moved_by(old: date | None, new: date | None) -> int:
    """Days the trip's first day moved: positive is later. Only a move from
    one date to another counts; setting dates on a trip that had none, or
    dropping them, leaves day 1 as day 1."""
    if old is None or new is None:
        return 0
    return (new - old).days


def move_calendar(db: Session, trip_id: int, days: int) -> None:
    """Keep everything on the calendar date it was on while the trip's
    first day moves `days` later: each day of the trip becomes `days`
    earlier. Things that end up before day 1 or after the last day are
    kept, just not shown; moving the dates back brings them back."""
    if days == 0:
        return
    minutes = days * MINUTES_PER_DAY
    for model in (Plan, Contest, Split):
        db.execute(
            update(model)
            .where(model.trip_id == trip_id)
            .values(start_min=model.start_min - minutes, end_min=model.end_min - minutes)
        )
    db.execute(
        update(Pin)
        .where(Pin.trip_id == trip_id, Pin.cost_start_day.is_not(None))
        .values(cost_start_day=Pin.cost_start_day - days, cost_end_day=Pin.cost_end_day - days)
    )
    _shift_days(db, TripDayPlace, TripDayPlace.trip_id == trip_id, days)
    pin_ids = select(Pin.id).where(Pin.trip_id == trip_id)
    _shift_days(db, AvailabilityOverride, AvailabilityOverride.pin_id.in_(pin_ids), days)
    # A pin's available days are a JSON list, so they move one rule at a time.
    for rule in db.scalars(select(AvailabilityRule).where(AvailabilityRule.pin_id.in_(pin_ids))):
        if rule.days:
            rule.days = [d - days for d in rule.days]


def _shift_days(db: Session, model, where, days: int) -> None:
    """day -= days on every matching row of a table where (…, day, …) is
    unique. One UPDATE could trip that constraint halfway through (moving
    day 2 onto day 1 before day 1 has moved on), so every row steps out to
    a day no row holds first, then back to where it's going."""
    db.execute(update(model).where(where).values(day=model.day + _PARK))
    db.execute(update(model).where(where).values(day=model.day - _PARK - days))
