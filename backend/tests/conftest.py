"""Test fixtures for the backend.

Everything runs against a throwaway SQLite file rather than the Postgres
the app really uses. That's a deliberate trade: the behaviour under test
here is the *scheduling* logic — what a window claims, what gets captured,
who can see a draft — none of which touches a Postgres-specific feature.
The one place the two dialects genuinely differ (the planstatus ENUM, and
whether contests.starts_at can be tightened to NOT NULL in place) is
handled in the migration and exercised by backend-ci.yml's own
`alembic upgrade head` run.

DATABASE_URL has to be set before app.db is imported, since the engine is
built at module scope — hence the environment write at the top of this
file, above any app import.
"""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta, timezone

_DB_FD, _DB_PATH = tempfile.mkstemp(suffix=".sqlite3")
os.close(_DB_FD)
os.environ["DATABASE_URL"] = f"sqlite:///{_DB_PATH}"
os.environ["ENVIRONMENT"] = "development"
os.environ["DEV_USER_EMAIL"] = "mei@example.com"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (  # noqa: E402
    Contest,
    ContestStatus,
    Contributor,
    Pin,
    Plan,
    PlanItem,
    PlanStatus,
    TravelItem,
    Trip,
    Vote,
)

# Day 1 of the fixture trip. Plan timestamps are tagged UTC purely as a
# bookkeeping convention for trip-local wall-clock time, exactly as
# app/seed.py does — never read them as real UTC instants.
TRIP_DAY_ONE = datetime(2026, 10, 3, tzinfo=timezone.utc)


def at(day_index: int, minute_of_day: int) -> datetime:
    """A wall-clock moment on day `day_index` (1-based) of the fixture
    trip."""
    hour, minute = divmod(minute_of_day, 60)
    return TRIP_DAY_ONE + timedelta(days=day_index - 1, hours=hour, minutes=minute)


@pytest.fixture(autouse=True)
def fresh_database():
    """A clean schema per test. Created from the models rather than by
    running Alembic: the migration is checked separately (see this module's
    docstring), and rebuilding eleven tables per test is faster than
    replaying revisions."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client():
    return TestClient(app)


def as_user(email: str) -> dict[str, str]:
    """Request headers standing in for Easy Auth's forwarded identity — see
    app/auth.py, which reads exactly this header when the full
    base64 principal blob isn't present."""
    return {"X-MS-CLIENT-PRINCIPAL-NAME": email}


class TripFixture:
    """A trip with a known cast, so tests can say `trip.jae` rather than
    threading ids through every call."""

    def __init__(self, db, trip, contributors, pins, travel_items):
        self.db = db
        self.trip = trip
        self.id = trip.id
        self.contributors = contributors
        self.pins = pins
        self.travel_items = travel_items
        for key, contributor in contributors.items():
            setattr(self, key, contributor)

    def place(
        self,
        *,
        day: int = 1,
        start: int,
        end: int,
        pin: str | None = None,
        travel_item: str | None = None,
        status: PlanStatus = PlanStatus.placed,
        created_by: str | None = None,
        items: list[tuple[str, int | None]] | None = None,
    ) -> Plan:
        """One plan on the calendar. `items` takes (pin key, duration
        override) pairs for the multi-stop cases; `pin`/`travel_item` are
        the one-stop shorthand everything else uses."""
        plan = Plan(
            trip_id=self.id,
            starts_at=at(day, start),
            ends_at=at(day, end),
            status=status,
            created_by_id=self.contributors[created_by].id if created_by else None,
        )
        self.db.add(plan)
        self.db.flush()
        if items is None:
            items = []
            if pin is not None:
                items = [(pin, None)]
        for position, (pin_key, override) in enumerate(items):
            self.db.add(
                PlanItem(
                    plan_id=plan.id,
                    pin_id=self.pins[pin_key].id,
                    position=position,
                    duration_minutes=override,
                )
            )
        if travel_item is not None:
            self.db.add(
                PlanItem(plan_id=plan.id, travel_item_id=self.travel_items[travel_item].id, position=0)
            )
        self.db.commit()
        self.db.refresh(plan)
        return plan

    def vote(self, contest_id: int, plan_id: int, *contributor_keys: str) -> None:
        for key in contributor_keys:
            self.db.add(
                Vote(contest_id=contest_id, plan_id=plan_id, contributor_id=self.contributors[key].id)
            )
        self.db.commit()


@pytest.fixture
def trip(db) -> TripFixture:
    row = Trip(name="Taiwan", region_line="Xiaoliuqiu", start_date=TRIP_DAY_ONE.date(), traveller_count=4)
    db.add(row)
    db.flush()

    contributors = {}
    for key, name, initial, is_owner in [
        ("mei", "Mei", "M", True),
        ("jae", "Jae", "J", False),
        ("ana", "Ana", "A", False),
        ("lin", "Lin", "L", False),
    ]:
        c = Contributor(
            trip_id=row.id,
            email=f"{key}@example.com",
            display_name=name,
            initial=initial,
            is_owner=is_owner,
        )
        db.add(c)
        contributors[key] = c
    db.flush()

    pins = {}
    for key, title, duration, cost in [
        ("vase", "Vase Rock", 50, 0),
        ("tide", "Meirendong tide pools", 70, 500),
        ("ice", "Shaved ice", 30, 400),
        ("trail", "Wild Boy trail loop", 80, 400),
        ("beach", "Geban Bay", 65, 0),
        ("cave", "Black Dwarf cave", 45, 300),
    ]:
        p = Pin(
            trip_id=row.id,
            title=title,
            short=title,
            place=title,
            region="Xiaoliuqiu",
            duration_minutes=duration,
            cost_cents=cost,
        )
        db.add(p)
        pins[key] = p

    travel_items = {}
    for key, title, duration, cost in [("ferry", "Ferry to Xiaoliuqiu", 75, 0)]:
        t = TravelItem(trip_id=row.id, title=title, kind="other", duration_minutes=duration, cost_cents=cost)
        db.add(t)
        travel_items[key] = t

    db.commit()
    return TripFixture(db, row, contributors, pins, travel_items)


__all__ = [
    "Contest",
    "ContestStatus",
    "PlanStatus",
    "TripFixture",
    "as_user",
    "at",
]
