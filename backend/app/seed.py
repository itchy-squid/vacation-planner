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

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import (
    AvailabilityRule,
    Block,
    BlockStatus,
    CandidateSet,
    CandidateSetStop,
    Contributor,
    Pin,
    Trip,
    TripPhase,
    Vote,
)

SEEDED_TRIP_NAMES = ["Taiwan", "Japan, spring", "Iceland ring road"]


def _wipe_seeded_trips(db: Session) -> None:
    for trip in db.scalars(select(Trip).where(Trip.name.in_(SEEDED_TRIP_NAMES))).all():
        db.delete(trip)
    db.commit()


def _add_pin(db: Session, trip: Trip, contributors: dict[str, Contributor], **kw) -> Pin:
    who = kw.pop("who", None)
    pin = Pin(trip_id=trip.id, added_by_id=contributors[who].id if who else None, **kw)
    db.add(pin)
    db.flush()
    return pin


def seed_taiwan(db: Session) -> None:
    trip = Trip(
        name="Taiwan",
        region_line="Taipei · Xiaoliuqiu · Hualien · Tainan",
        start_date=date(2026, 10, 3),
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

    # ---- Pins — verbatim content from frontend/src/data/pins.js ----
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

    # Logistics/activity items backing the schedule's non-contested blocks
    # below (Day 1 arrival, Day 5's ferry + snorkel) — real pins like any
    # other, just tagged "logistics" so they read as travel legs rather
    # than optional attractions.
    logistics = [
        dict(id_="p25", title="Arrive Taipei · check in", short="Arrival", place="Taoyuan Airport / Da'an, Taipei", region="Taipei", lat=None, lng=None, duration_minutes=60, cost_cents=0, notes="", link="", tags=["logistics"]),
        dict(id_="p26", title="Ferry to Xiaoliuqiu", short="Ferry", place="Donggang", region="Xiaoliuqiu", lat=None, lng=None, duration_minutes=75, cost_cents=0, notes="", link="", tags=["logistics"]),
        dict(id_="p27", title="Turtle snorkel, Meirendong", short="Turtle snorkel", place="Meirendong, Xiaoliuqiu", region="Xiaoliuqiu", lat=22.3391, lng=120.3688, duration_minutes=150, cost_cents=4500, who="jae", notes="", link="", tags=["swim", "outdoors"]),
    ]

    pins_by_local_id: dict[str, Pin] = {}
    for spec in xiaoliuqiu + taipei + hualien + tainan + logistics:
        local_id = spec.pop("id_")
        pin = _add_pin(db, trip, contributors, **spec)
        pins_by_local_id[local_id] = pin

    # Availability rules — the seven Xiaoliuqiu pins the Day 5 contested
    # block is built around (frontend/src/data/pins.js AVAILABILITY_RULES).
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

    # ---- Day 5's contested block: "the core screen" (handoff README
    # screen 5) — two pre-seeded candidate sets, matching the exact pin
    # groupings and base vote counts the frontend mock hardcoded. ----
    block = Block(
        trip_id=trip.id,
        day_index=5,
        start_minute=780,
        end_minute=960,
        region="Xiaoliuqiu",
        status=BlockStatus.contested,
    )
    db.add(block)
    db.flush()

    set_a = CandidateSet(block_id=block.id, key="A", label="Set A", color="#8f4478", is_draft=False)
    set_b = CandidateSet(block_id=block.id, key="B", label="Set B", color="#3d8a9c", is_draft=False)
    db.add_all([set_a, set_b])
    db.flush()

    for position, local_id in enumerate(["p1", "p2", "p3"]):
        db.add(CandidateSetStop(candidate_set_id=set_a.id, pin_id=pins_by_local_id[local_id].id, position=position))
    for position, local_id in enumerate(["p4", "p5"]):
        db.add(CandidateSetStop(candidate_set_id=set_b.id, pin_id=pins_by_local_id[local_id].id, position=position))

    # Base votes — 3 for A, 2 for B (frontend derive.js BASE_VOTES),
    # deliberately excluding Mei (the dev user) so "cast your own vote" is
    # still there to try locally.
    for key, voter_keys, target_set in [("A", ["jae", "ana", "theo"], set_a), ("B", ["lin", "priya"], set_b)]:
        for voter_key in voter_keys:
            db.add(Vote(block_id=block.id, candidate_set_id=target_set.id, contributor_id=contributors[voter_key].id))
    db.flush()

    # ---- Every other block on the schedule: single-pin blocks with real
    # placed/pencilled/empty status, replacing what used to be
    # frontend/src/data/schedule.js's OTHER_DAY_BLOCKS/DAY5_FIXED_BLOCKS
    # mock content. A "simple" block is just a one-stop CandidateSet (the
    # same tables the contested block above uses) — DaySchedule.jsx reads
    # its title/cost straight off that stop's pin, so there is nothing
    # schedule-specific to store beyond the block itself. ----
    def _simple_block(pin: Pin, day_index: int, start_minute: int, end_minute: int, status: BlockStatus) -> Block:
        b = Block(trip_id=trip.id, day_index=day_index, start_minute=start_minute, end_minute=end_minute, region=pin.region, status=status)
        db.add(b)
        db.flush()
        cs = CandidateSet(block_id=b.id, key="A", label=pin.title, color="var(--accent)", is_draft=False)
        db.add(cs)
        db.flush()
        db.add(CandidateSetStop(candidate_set_id=cs.id, pin_id=pin.id, position=0))
        return b

    def _empty_block(day_index: int, start_minute: int, region: str) -> Block:
        b = Block(trip_id=trip.id, day_index=day_index, start_minute=start_minute, end_minute=start_minute + 60, region=region, status=BlockStatus.empty)
        db.add(b)
        return b

    p = pins_by_local_id
    _simple_block(p["p25"], day_index=1, start_minute=780, end_minute=840, status=BlockStatus.placed)
    _simple_block(p["p9"], day_index=1, start_minute=1080, end_minute=1180, status=BlockStatus.placed)

    _simple_block(p["p8"], day_index=2, start_minute=950, end_minute=1040, status=BlockStatus.placed)
    _simple_block(p["p13"], day_index=2, start_minute=1140, end_minute=1215, status=BlockStatus.pencilled)
    _empty_block(day_index=2, start_minute=1230, region="Taipei")

    _simple_block(p["p10"], day_index=3, start_minute=570, end_minute=720, status=BlockStatus.placed)
    _simple_block(p["p11"], day_index=3, start_minute=900, end_minute=1020, status=BlockStatus.placed)

    _simple_block(p["p14"], day_index=4, start_minute=600, end_minute=690, status=BlockStatus.placed)
    _empty_block(day_index=4, start_minute=780, region="Taipei")

    _simple_block(p["p26"], day_index=5, start_minute=480, end_minute=555, status=BlockStatus.placed)
    _simple_block(p["p27"], day_index=5, start_minute=570, end_minute=720, status=BlockStatus.placed)

    _simple_block(p["p7"], day_index=6, start_minute=570, end_minute=615, status=BlockStatus.pencilled)
    _empty_block(day_index=6, start_minute=720, region="Xiaoliuqiu")

    _simple_block(p["p16"], day_index=7, start_minute=480, end_minute=660, status=BlockStatus.placed)
    _empty_block(day_index=7, start_minute=780, region="Hualien")

    _empty_block(day_index=8, start_minute=540, region="Hualien")

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
