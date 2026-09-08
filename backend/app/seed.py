"""Local/dev seed data — populates the schema with the same sample trip the
frontend used to ship as static mock data (frontend/src/data/*.js), so
switching the UI over to the real API shows the same content it always has.

Idempotent: running it again wipes and recreates every trip it seeds (matched
by name), so it's safe to re-run after a schema change. Run with:

    uv run python -m app.seed

Not used in production — Azure Postgres starts empty and gets real data from
real use; see infra/README.md.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import (
    AvailabilityRule,
    Contest,
    ContestStatus,
    Contributor,
    Pin,
    Plan,
    PlanItem,
    PlanStatus,
    TravelItem,
    Trip,
    TripPhase,
    Vote,
)

SEEDED_TRIP_NAMES = ["Taiwan", "Japan, spring", "Iceland ring road"]

# The Taiwan trip's day 1 is Oct 3, 2026 — see seed_taiwan's Trip row below.
# Plan.starts_at/ends_at are tz-aware DateTime columns, but nothing in this
# schema stores a trip's real timezone (see models.py Plan docstring), so a
# fixed tzinfo=UTC is used purely as a bookkeeping convention for
# "trip-local wall-clock time" — the same sidestep the frontend's own
# parseISODate already makes. It should never be read as a real UTC instant.
TAIWAN_TRIP_START = date(2026, 10, 3)


def _wipe_seeded_trips(db: Session) -> None:
    for trip in db.scalars(select(Trip).where(Trip.name.in_(SEEDED_TRIP_NAMES))).all():
        db.delete(trip)
    db.commit()


def _taiwan_dt(day_index: int, minute_of_day: int) -> datetime:
    """day_index is 1-based, matching the old Block model's day_index and
    the AvailabilityRule "days" values below (e.g. day_index=5 is Oct 7,
    matching those rules' "Oct 7-8")."""
    d = TAIWAN_TRIP_START + timedelta(days=day_index - 1)
    hour, minute = divmod(minute_of_day, 60)
    return datetime(d.year, d.month, d.day, hour, minute, tzinfo=timezone.utc)


def _add_pin(db: Session, trip: Trip, contributors: dict[str, Contributor], **kw) -> Pin:
    who = kw.pop("who", None)
    pin = Pin(trip_id=trip.id, added_by_id=contributors[who].id if who else None, **kw)
    db.add(pin)
    db.flush()
    return pin


def _placed_plan(
    db: Session,
    trip: Trip,
    day_index: int,
    start_minute: int,
    end_minute: int,
    status: PlanStatus,
    *,
    pin: Pin | None = None,
    travel_item: TravelItem | None = None,
    created_by: Contributor | None = None,
) -> Plan:
    """A single-item Plan — the new-model equivalent of the old model's
    "simple block" (a one-stop CandidateSet). DaySchedule.jsx reads the
    item's title/cost straight off the placed pin/travel item, so there's
    nothing schedule-specific to store beyond the Plan + its one PlanItem."""
    plan = Plan(
        trip_id=trip.id,
        starts_at=_taiwan_dt(day_index, start_minute),
        ends_at=_taiwan_dt(day_index, end_minute),
        status=status,
        created_by_id=created_by.id if created_by else None,
    )
    db.add(plan)
    db.flush()
    db.add(PlanItem(plan_id=plan.id, pin_id=pin.id if pin else None, travel_item_id=travel_item.id if travel_item else None, position=0))
    return plan


def seed_taiwan(db: Session) -> None:
    trip = Trip(
        name="Taiwan",
        region_line="Taipei · Xiaoliuqiu · Hualien · Tainan",
        start_date=TAIWAN_TRIP_START,
        end_date=date(2026, 10, 10),
        phase=TripPhase.scheduling,
    )
    db.add(trip)
    db.flush()

    # Emails matching DEV_USER_EMAIL's default ("mei@example.com") so local
    # requests (no Easy Auth in front of you — see app/auth.py) resolve to
    # the real seeded Mei row, owner included, instead of auto-enrolling a
    # stray contributor.
    contributor_specs = [
        ("mei", "mei@example.com", "Mei", "M", "var(--who-1)", True),
        ("jae", "jae@example.com", "Jae", "J", "var(--who-2)", False),
        ("ana", "ana@example.com", "Ana", "A", "var(--who-3)", False),
        ("lin", "lin@example.com", "Lin", "L", "var(--who-4)", False),
        ("theo", "theo@example.com", "Theo", "T", "var(--who-1)", False),
        ("priya", "priya@example.com", "Priya", "P", "var(--who-2)", False),
    ]
    contributors: dict[str, Contributor] = {}
    for key, email, name, initial, tint, is_owner in contributor_specs:
        c = Contributor(trip_id=trip.id, email=email, display_name=name, initial=initial, tint=tint, is_owner=is_owner)
        db.add(c)
        db.flush()
        contributors[key] = c

    # ---- Pins — verbatim content from frontend/src/data/pins.js, minus
    # the two logistics legs (arrival, ferry) that are now TravelItems
    # (see travel_item_specs below) rather than Pins — see
    # docs/features/scheduling-feature-spec.md's Pin/TravelItem split. ----
    xiaoliuqiu = [
        dict(id_="p1", title="Vase Rock", short="Vase Rock", place="Xiaoliuqiu, Pingtung", region="Xiaoliuqiu", lat=22.3487, lng=120.3712, duration_minutes=50, cost_cents=0, who="mei", notes="Best at low tide — 14:10 that day.", link="maps.app/vase-rock", tags=["outdoors", "swim"]),
        dict(id_="p2", title="Meirendong tide pools", short="Tide pools", place="Meirendong, Xiaoliuqiu", region="Xiaoliuqiu", lat=22.3391, lng=120.3688, duration_minutes=70, cost_cents=500, who="jae", notes="Reef shoes needed. Jae has two spare pairs.", link="maps.app/meirendong", tags=["swim", "outdoors"]),
        dict(id_="p3", title="Shaved ice, Benfu St", short="Shaved ice", place="Benfu Street, Xiaoliuqiu", region="Xiaoliuqiu", lat=22.3442, lng=120.3801, duration_minutes=30, cost_cents=400, who="lin", notes="Closes at 17:00 on weekdays.", link="instagram.com/benfu-ice", tags=["food"]),
        dict(id_="p4", title="Wild Boy trail loop", short="Wild Boy", place="Xiaoliuqiu west coast", region="Xiaoliuqiu", lat=22.3355, lng=120.3610, duration_minutes=80, cost_cents=400, who="lin", notes="Shaded most of the way; last stretch is exposed.", link="maps.app/wild-boy-trail", tags=["hike", "outdoors"]),
        dict(id_="p5", title="Beach at Geban Bay", short="Geban Bay", place="Geban Bay, Xiaoliuqiu", region="Xiaoliuqiu", lat=22.3298, lng=120.3745, duration_minutes=65, cost_cents=0, who="ana", notes="Shade is gone after 15:30.", link="maps.app/geban-bay", tags=["swim", "sunset"]),
        dict(id_="p6", title="Sanfu fishing port", short="Sanfu port", place="Sanfu, Xiaoliuqiu", region="Xiaoliuqiu", lat=22.3521, lng=120.3777, duration_minutes=40, cost_cents=0, who="jae", notes="", link="maps.app/sanfu-port", tags=["outdoors"]),
        dict(id_="p7", title="Black Dwarf cave", short="Black Dwarf", place="Southeast Xiaoliuqiu", region="Xiaoliuqiu", lat=22.3312, lng=120.3829, duration_minutes=45, cost_cents=300, who="mei", notes="", link="maps.app/black-dwarf", tags=["rainy-day"]),
    ]
    taipei = [
        dict(id_="p8", title="Elephant Mountain lookout", short="Elephant Mtn", place="Xinyi, Taipei", region="Taipei", lat=25.0270, lng=121.5703, duration_minutes=90, cost_cents=0, who="ana", notes="Ana raised the heat — go before 09:00 or after 16:00.", link="maps.app/elephant-mountain", tags=["hike", "sunset"]),
        dict(id_="p9", title="Raohe Night Market", short="Raohe Market", place="Songshan, Taipei", region="Taipei", lat=25.0505, lng=121.5773, duration_minutes=100, cost_cents=1500, who="jae", notes="Pepper buns at the temple end of the street.", link="maps.app/raohe-market", tags=["food"]),
        dict(id_="p10", title="National Palace Museum", short="Palace Museum", place="Shilin, Taipei", region="Taipei", lat=25.1024, lng=121.5486, duration_minutes=150, cost_cents=1200, who="mei", notes="", link="npm.gov.tw", tags=["rainy-day"]),
        dict(id_="p11", title="Beitou hot springs", short="Beitou springs", place="Beitou, Taipei", region="Taipei", lat=25.1367, lng=121.5084, duration_minutes=120, cost_cents=2000, who="lin", notes="", link="maps.app/beitou-hot-springs", tags=["rainy-day"]),
        dict(id_="p12", title="Bopiliao Historic Block", short="Bopiliao", place="Wanhua, Taipei", region="Taipei", lat=25.0374, lng=121.5013, duration_minutes=60, cost_cents=0, who="ana", notes="", link="maps.app/bopiliao", tags=["rainy-day"]),
        dict(id_="p13", title="Din Tai Fung, Xinyi", short="Din Tai Fung", place="Xinyi, Taipei", region="Taipei", lat=25.0339, lng=121.5645, duration_minutes=75, cost_cents=2500, who="jae", notes="Reservation opens 2 weeks out.", link="maps.app/din-tai-fung-xinyi", tags=["food"]),
        dict(id_="p14", title="Ximending street art", short="Ximending", place="Wanhua, Taipei", region="Taipei", lat=25.0421, lng=121.5079, duration_minutes=90, cost_cents=500, who="lin", notes="", link="maps.app/ximending", tags=["kid-ok"]),
        dict(id_="p15", title="Yangmingshan sulphur vents", short="Yangmingshan", place="Beitou, Taipei", region="Taipei", lat=25.1590, lng=121.5480, duration_minutes=130, cost_cents=0, who="mei", notes="Unlit trail — daylight only.", link="maps.app/yangmingshan", tags=["hike", "outdoors"]),
    ]
    hualien = [
        dict(id_="p16", title="Taroko Gorge trailhead", short="Taroko Gorge", place="Xiulin, Hualien", region="Hualien", lat=24.1584, lng=121.6244, duration_minutes=180, cost_cents=0, who="ana", notes="Permit needed for the Zhuilu Old Trail spur.", link="maps.app/taroko-gorge", tags=["hike", "outdoors"]),
        dict(id_="p17", title="Qixingtan pebble beach", short="Qixingtan", place="Xincheng, Hualien", region="Hualien", lat=24.0453, lng=121.6403, duration_minutes=60, cost_cents=0, who="jae", notes="", link="maps.app/qixingtan", tags=["swim", "sunset"]),
        dict(id_="p18", title="Dongdamen Night Market", short="Dongdamen", place="Hualien City", region="Hualien", lat=23.9769, lng=121.6069, duration_minutes=90, cost_cents=1200, who="lin", notes="", link="maps.app/dongdamen-market", tags=["food"]),
        dict(id_="p19", title="Liyu Lake bike loop", short="Liyu Lake", place="Shoufeng, Hualien", region="Hualien", lat=23.8956, lng=121.5497, duration_minutes=100, cost_cents=600, who="mei", notes="", link="maps.app/liyu-lake", tags=["outdoors", "kid-ok"]),
    ]
    tainan = [
        dict(id_="p20", title="Anping Old Fort", short="Anping Fort", place="Anping, Tainan", region="Tainan", lat=22.9976, lng=120.1616, duration_minutes=80, cost_cents=800, who="jae", notes="", link="maps.app/anping-fort", tags=["rainy-day"]),
        dict(id_="p21", title="Shennong Street", short="Shennong St", place="West Central, Tainan", region="Tainan", lat=22.9958, lng=120.1985, duration_minutes=70, cost_cents=0, who="ana", notes="", link="maps.app/shennong-street", tags=["kid-ok"]),
        dict(id_="p22", title="Chihkan Tower", short="Chihkan Tower", place="West Central, Tainan", region="Tainan", lat=22.9971, lng=120.2027, duration_minutes=60, cost_cents=600, who="lin", notes="", link="maps.app/chihkan-tower", tags=["rainy-day"]),
        dict(id_="p23", title="Garden Night Market", short="Garden Market", place="North, Tainan", region="Tainan", lat=23.0129, lng=120.1993, duration_minutes=100, cost_cents=1000, who="mei", notes="Weekends only.", link="maps.app/garden-night-market", tags=["food"]),
        dict(id_="p24", title="Sicao Green Tunnel", short="Green Tunnel", place="Annan, Tainan", region="Tainan", lat=23.0447, lng=120.1289, duration_minutes=50, cost_cents=900, who="jae", notes="", link="maps.app/sicao-green-tunnel", tags=["outdoors", "kid-ok"]),
    ]
    # An activity, not a logistics leg — a real place with a cost and a
    # photo-worthy identity — so it stays a Pin (see the TravelItem split
    # note above).
    logistics_pin = [
        dict(id_="p27", title="Turtle snorkel, Meirendong", short="Turtle snorkel", place="Meirendong, Xiaoliuqiu", region="Xiaoliuqiu", lat=22.3391, lng=120.3688, duration_minutes=150, cost_cents=4500, who="jae", notes="", link="", tags=["swim", "outdoors"]),
    ]

    pins_by_local_id: dict[str, Pin] = {}
    for spec in xiaoliuqiu + taipei + hualien + tainan + logistics_pin:
        local_id = spec.pop("id_")
        pin = _add_pin(db, trip, contributors, **spec)
        pins_by_local_id[local_id] = pin

    # ---- Travel items — the trip's two logistics legs, as TravelItems
    # rather than Pins (see docs/features/scheduling-feature-spec.md). ----
    arrival = TravelItem(trip_id=trip.id, title="Arrive Taipei · check in", kind="flight", duration_minutes=60, cost_cents=0, added_by_id=None)
    ferry = TravelItem(trip_id=trip.id, title="Ferry to Xiaoliuqiu", kind="other", duration_minutes=75, cost_cents=0, added_by_id=None)
    db.add_all([arrival, ferry])
    db.flush()

    # Availability rules — the seven Xiaoliuqiu pins the day 5 contest is
    # built around (frontend/src/data/pins.js AVAILABILITY_RULES).
    availability = {
        "p1": ([7, 8], ["PM"], ["On Xiaoliuqiu only: Oct 7–8", "Needs low tide — 13:00–16:00"]),
        "p2": ([7, 8], ["AM", "PM"], ["On Xiaoliuqiu only: Oct 7–8", "Snorkel boats stop at 16:00"]),
        "p3": ([7, 8], ["AM", "PM"], ["On Xiaoliuqiu only: Oct 7–8", "Closes 17:00 on weekdays"]),
        "p4": ([7, 8], ["AM", "PM"], ["On Xiaoliuqiu only: Oct 7–8", "Unlit trail — daylight only"]),
        "p5": ([7, 8], ["PM", "EVE"], ["On Xiaoliuqiu only: Oct 7–8", "Sunset side — afternoon or later"]),
        "p6": ([7, 8], ["AM"], ["On Xiaoliuqiu only: Oct 7–8", "Fish market winds down by 10:00"]),
        "p7": ([7, 8], ["AM", "PM"], ["On Xiaoliuqiu only: Oct 7–8", "Ticket office 08:00–16:30"]),
    }
    for local_id, (days, bands, reasons) in availability.items():
        db.add(AvailabilityRule(pin_id=pins_by_local_id[local_id].id, days=days, bands=bands, reasons=reasons))

    # ---- Day 5's contest: "the core screen" (handoff README screen 5) —
    # two competing Plans for the same 13:00-16:00 slot, matching the exact
    # pin groupings and base vote counts the frontend mock hardcoded, now
    # expressed as a real Contest instead of two pre-seeded CandidateSets
    # on a fixed Block. ----
    contest = Contest(trip_id=trip.id, status=ContestStatus.open)
    db.add(contest)
    db.flush()

    plan_a = Plan(
        trip_id=trip.id,
        starts_at=_taiwan_dt(5, 780),
        ends_at=_taiwan_dt(5, 960),
        status=PlanStatus.contested,
        contest_id=contest.id,
        label="Set A",
        color="#8f4478",
    )
    plan_b = Plan(
        trip_id=trip.id,
        starts_at=_taiwan_dt(5, 780),
        ends_at=_taiwan_dt(5, 960),
        status=PlanStatus.contested,
        contest_id=contest.id,
        label="Set B",
        color="#3d8a9c",
    )
    db.add_all([plan_a, plan_b])
    db.flush()

    for position, local_id in enumerate(["p1", "p2", "p3"]):
        db.add(PlanItem(plan_id=plan_a.id, pin_id=pins_by_local_id[local_id].id, position=position))
    for position, local_id in enumerate(["p4", "p5"]):
        db.add(PlanItem(plan_id=plan_b.id, pin_id=pins_by_local_id[local_id].id, position=position))
    db.flush()

    # Base votes — 3 for A, 2 for B (frontend derive.js BASE_VOTES),
    # deliberately excluding Mei (the dev user) so "cast your own vote" is
    # still there to try locally.
    for voter_key, target_plan in [("jae", plan_a), ("ana", plan_a), ("theo", plan_a), ("lin", plan_b), ("priya", plan_b)]:
        db.add(Vote(contest_id=contest.id, plan_id=target_plan.id, contributor_id=contributors[voter_key].id))
    db.flush()

    # ---- Every other placement on the schedule: single-item Plans with
    # real placed/pencilled status, replacing what used to be frontend/src/
    # data/schedule.js's OTHER_DAY_BLOCKS/DAY5_FIXED_BLOCKS mock content.
    # Slots that used to be "empty" blocks are simply left unrepresented —
    # there's nothing to store for a time nobody has placed anything into;
    # the calendar just renders that stretch as open. Every pin not placed
    # below is left in the tray, unplaced, ready to be tap-to-placed. ----
    p = pins_by_local_id
    _placed_plan(db, trip, day_index=1, start_minute=780, end_minute=840, status=PlanStatus.placed, travel_item=arrival)
    _placed_plan(db, trip, day_index=1, start_minute=1080, end_minute=1180, status=PlanStatus.placed, pin=p["p9"])

    _placed_plan(db, trip, day_index=2, start_minute=950, end_minute=1040, status=PlanStatus.placed, pin=p["p8"])
    _placed_plan(db, trip, day_index=2, start_minute=1140, end_minute=1215, status=PlanStatus.pencilled, pin=p["p13"])

    _placed_plan(db, trip, day_index=3, start_minute=570, end_minute=720, status=PlanStatus.placed, pin=p["p10"])
    _placed_plan(db, trip, day_index=3, start_minute=900, end_minute=1020, status=PlanStatus.placed, pin=p["p11"])

    _placed_plan(db, trip, day_index=4, start_minute=600, end_minute=690, status=PlanStatus.placed, pin=p["p14"])

    _placed_plan(db, trip, day_index=5, start_minute=480, end_minute=555, status=PlanStatus.placed, travel_item=ferry)
    _placed_plan(db, trip, day_index=5, start_minute=570, end_minute=720, status=PlanStatus.placed, pin=p["p27"])

    _placed_plan(db, trip, day_index=6, start_minute=570, end_minute=615, status=PlanStatus.pencilled, pin=p["p7"])

    _placed_plan(db, trip, day_index=7, start_minute=480, end_minute=660, status=PlanStatus.placed, pin=p["p16"])

    db.commit()


def seed_light_trip(
    db: Session,
    name: str,
    region_line: str,
    start_date: date | None,
    end_date: date | None,
    phase: TripPhase,
    pin_titles: list[tuple[str, str]],
) -> None:
    """A lighter trip for the Trips Home "Also planning" rail — just enough
    real rows (a couple of contributors + pins) that its card reads from
    actual counts instead of hand-typed copy."""
    trip = Trip(name=name, region_line=region_line, start_date=start_date, end_date=end_date, phase=phase)
    db.add(trip)
    db.flush()

    owner = Contributor(trip_id=trip.id, email=f"{name.split(',')[0].split()[0].lower()}.owner@example.com", display_name="Owner", initial="O", tint="var(--who-1)", is_owner=True)
    guest = Contributor(trip_id=trip.id, email=f"{name.split(',')[0].split()[0].lower()}.guest@example.com", display_name="Guest", initial="G", tint="var(--who-2)", is_owner=False)
    db.add_all([owner, guest])
    db.flush()

    for i, (title, region) in enumerate(pin_titles):
        db.add(Pin(trip_id=trip.id, title=title, short=title, place=f"{region}", region=region, duration_minutes=60, cost_cents=0, added_by_id=(owner.id if i % 2 == 0 else guest.id)))

    db.commit()


def run() -> None:
    # Assumes migrations have already been applied (`uv run alembic upgrade
    # head`). We deliberately don't call Base.metadata.create_all() here:
    # doing so on a database Alembic hasn't touched yet would create the
    # tables without stamping alembic_version, and a later `alembic upgrade
    # head` would then fail trying to create tables that already exist. If
    # this raises "relation ... does not exist", run the migration first.
    db = SessionLocal()
    try:
        _wipe_seeded_trips(db)
        seed_taiwan(db)
        seed_light_trip(
            db,
            "Japan, spring",
            "Tokyo · Kyoto",
            None,  # dates still tentative
            None,
            TripPhase.ideation,
            [("Shinjuku Gyoen", "Tokyo"), ("Fushimi Inari", "Kyoto"), ("Nishiki Market", "Kyoto")],
        )
        seed_light_trip(
            db,
            "Iceland ring road",
            "Reykjavik · Vik · Akureyri",
            date(2026, 6, 15),
            date(2026, 6, 25),
            TripPhase.locked,
            [("Golden Circle", "Reykjavik"), ("Diamond Beach", "Vik"), ("Godafoss", "Akureyri"), ("Blue Lagoon", "Reykjavik")],
        )
        print("Seeded:", ", ".join(SEEDED_TRIP_NAMES))
    finally:
        db.close()


if __name__ == "__main__":
    run()
