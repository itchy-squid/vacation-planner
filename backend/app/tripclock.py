"""Comparing two of this app's timestamps.

Plan/Contest timestamps are tz-aware columns, but they are not real UTC
instants: nothing in the schema stores a trip's timezone yet, so the whole
stack tags them UTC purely as a bookkeeping convention for "trip-local
wall-clock time" (see models.py Plan, app/seed.py's TAIWAN_TRIP_START note,
and the frontend's lib/planTime.js, which reads the digits out of the ISO
string rather than going through a Date).

The wrinkle is that the same moment can reach Python two ways: parsed from
a request body (always aware, because the client sends an offset) or read
back from the database (aware on PostgreSQL's timestamptz, naive on
SQLite). Subtracting or comparing one of each raises, or silently compares
unequal. Rather than let every call site remember which kind it's holding,
both helpers below normalise first — and under this app's convention,
attaching UTC to a naive value is not a guess, it's the same convention
that put it there.
"""

from __future__ import annotations

from datetime import datetime, timezone


def as_trip_time(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def minutes_between(later: datetime, earlier: datetime) -> int:
    return int((as_trip_time(later) - as_trip_time(earlier)).total_seconds() // 60)


def same_moment(a: datetime, b: datetime) -> bool:
    return as_trip_time(a) == as_trip_time(b)
