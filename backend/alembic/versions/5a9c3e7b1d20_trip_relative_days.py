"""trip-relative days: store the calendar by day of the trip, not by date

Revision ID: 5a9c3e7b1d20
Revises: b8e4f2a7c913
Create Date: 2026-10-05 18:00:00.000000

A trip can now be planned before its dates are known ("about 5 days"), so
nothing on its calendar can be pinned to a real date any more
(app/tripdays.py):

- trips gain `length_days` and `rough_month`, for a trip without dates;
- plans, contests and splits: `starts_at`/`ends_at` (wall-clock time tagged
  UTC) become `start_min`/`end_min`, minutes from 00:00 on the trip's first
  day;
- trip_day_places: `date` becomes `day`, 1 for the first day;
- pins: `cost_start_date`/`cost_end_date` become `cost_start_day`/
  `cost_end_day`, numbered the same way;
- availability rules and overrides kept their days as days of the month
  (the frontend keyed its grid by them); they become days of the trip.

Each row is converted against its trip's start_date. A trip without one
can't have had places for a day (the API refused them), but nothing stopped
a plan; for such a trip the earliest date on its calendar is taken as day 1,
and the trip is given a length that covers everything on it.

A day of the month is matched to the day of the trip that falls on it, or
failing that read as that day of the trip's first month. On a trip without
dates the grid already numbered its days from 1, so those are left as
they are.

The downgrade converts back the same way, against the trip's start_date,
or its creation date for a trip that has none.
"""
from datetime import date, datetime, timedelta, timezone

from alembic import op
import json

import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '5a9c3e7b1d20'
down_revision = 'b8e4f2a7c913'
branch_labels = None
depends_on = None

DAY = 1440
TIMED = ('plans', 'contests', 'splits')


def _as_date(value) -> date | None:
    if value is None or isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value[:10])
    return value.date()


def _wall_clock(value) -> datetime:
    """A stored timestamp as the wall-clock time it was written as. They
    were tagged UTC by convention (the old app/tripclock.py), so an aware
    one is read back in UTC and a naive one (SQLite) is already it."""
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _day_ones(bind) -> dict[int, date]:
    """Each trip's day 1: its start date, else the earliest date anything
    on its calendar was on. Trips with neither aren't listed."""
    starts = {row.id: _as_date(row.start_date) for row in bind.execute(sa.text('SELECT id, start_date FROM trips'))}
    earliest: dict[int, date] = {}

    def seen(trip_id: int, on: date | None) -> None:
        if on is not None and (trip_id not in earliest or on < earliest[trip_id]):
            earliest[trip_id] = on

    for table in TIMED:
        for row in bind.execute(sa.text(f'SELECT trip_id, starts_at FROM {table}')):
            seen(row.trip_id, _wall_clock(row.starts_at).date())
    for row in bind.execute(sa.text('SELECT trip_id, date FROM trip_day_places')):
        seen(row.trip_id, _as_date(row.date))
    for row in bind.execute(sa.text('SELECT trip_id, cost_start_date FROM pins WHERE cost_start_date IS NOT NULL')):
        seen(row.trip_id, _as_date(row.cost_start_date))
    out = dict(earliest)
    out.update({trip_id: start for trip_id, start in starts.items() if start is not None})
    return out


def _trip_starts(bind) -> dict[int, tuple[date, int]]:
    """Each trip with dates: its start, and how many days it has."""
    out = {}
    for row in bind.execute(sa.text('SELECT id, start_date, end_date FROM trips WHERE start_date IS NOT NULL')):
        start = _as_date(row.start_date)
        end = _as_date(row.end_date) or start
        out[row.id] = (start, max(1, (end - start).days + 1))
    return out


def _convert_availability(bind, convert) -> None:
    """Every pin's available days and overrides, through `convert(trip_id,
    day)`."""
    pin_trip = {row.id: row.trip_id for row in bind.execute(sa.text('SELECT id, trip_id FROM pins'))}
    for row in bind.execute(sa.text('SELECT id, pin_id, days FROM availability_rules')).all():
        days = json.loads(row.days) if isinstance(row.days, str) else row.days
        if not days:
            continue
        moved = [convert(pin_trip[row.pin_id], d) for d in days]
        bind.execute(sa.text('UPDATE availability_rules SET days = :d WHERE id = :id'), {'d': json.dumps(moved), 'id': row.id})

    overrides = bind.execute(sa.text('SELECT id, pin_id, day, band FROM availability_overrides')).all()
    # Every override steps out of the way first, so none collides with
    # another's old (pin, day, band) on the way to its new one.
    for row in overrides:
        bind.execute(sa.text('UPDATE availability_overrides SET day = :d WHERE id = :id'), {'d': -1_000_000 - row.id, 'id': row.id})
    seen = set()
    for row in overrides:
        day = convert(pin_trip[row.pin_id], row.day)
        if (row.pin_id, day, row.band) in seen:
            bind.execute(sa.text('DELETE FROM availability_overrides WHERE id = :id'), {'id': row.id})
            continue
        seen.add((row.pin_id, day, row.band))
        bind.execute(sa.text('UPDATE availability_overrides SET day = :d WHERE id = :id'), {'d': day, 'id': row.id})


def upgrade() -> None:
    bind = op.get_bind()
    op.add_column('trips', sa.Column('length_days', sa.Integer(), nullable=True))
    op.add_column('trips', sa.Column('rough_month', sa.Integer(), nullable=True))
    day_one = _day_ones(bind)
    last_day: dict[int, int] = {}

    def reach(trip_id: int, day: int) -> None:
        last_day[trip_id] = max(last_day.get(trip_id, 1), day)

    def minute_of(trip_id: int, value) -> int:
        clock = _wall_clock(value)
        minute = (clock.date() - day_one[trip_id]).days * DAY + clock.hour * 60 + clock.minute
        reach(trip_id, minute // DAY + 1)
        return minute

    for table in TIMED:
        op.add_column(table, sa.Column('start_min', sa.Integer(), nullable=True))
        op.add_column(table, sa.Column('end_min', sa.Integer(), nullable=True))
        rows = bind.execute(sa.text(f'SELECT id, trip_id, starts_at, ends_at FROM {table}')).all()
        for row in rows:
            bind.execute(
                sa.text(f'UPDATE {table} SET start_min = :s, end_min = :e WHERE id = :id'),
                {'s': minute_of(row.trip_id, row.starts_at), 'e': minute_of(row.trip_id, row.ends_at), 'id': row.id},
            )
        with op.batch_alter_table(table) as batch:
            batch.alter_column('start_min', existing_type=sa.Integer(), nullable=False)
            batch.alter_column('end_min', existing_type=sa.Integer(), nullable=False)
            batch.drop_column('starts_at')
            batch.drop_column('ends_at')

    op.add_column('trip_day_places', sa.Column('day', sa.Integer(), nullable=True))
    for row in bind.execute(sa.text('SELECT id, trip_id, date FROM trip_day_places')).all():
        day = (_as_date(row.date) - day_one[row.trip_id]).days + 1
        reach(row.trip_id, day)
        bind.execute(sa.text('UPDATE trip_day_places SET day = :d WHERE id = :id'), {'d': day, 'id': row.id})
    with op.batch_alter_table('trip_day_places') as batch:
        batch.drop_constraint('uq_trip_day_place_position', type_='unique')
        batch.drop_constraint('uq_trip_day_place_name', type_='unique')
        batch.alter_column('day', existing_type=sa.Integer(), nullable=False)
        batch.drop_column('date')
        batch.create_unique_constraint('uq_trip_day_place_position', ['trip_id', 'day', 'position'])
        batch.create_unique_constraint('uq_trip_day_place_name', ['trip_id', 'day', 'name_key'])

    op.add_column('pins', sa.Column('cost_start_day', sa.Integer(), nullable=True))
    op.add_column('pins', sa.Column('cost_end_day', sa.Integer(), nullable=True))
    rows = bind.execute(
        sa.text('SELECT id, trip_id, cost_start_date, cost_end_date FROM pins WHERE cost_start_date IS NOT NULL')
    ).all()
    for row in rows:
        first = (_as_date(row.cost_start_date) - day_one[row.trip_id]).days + 1
        last = (_as_date(row.cost_end_date) - day_one[row.trip_id]).days + 1
        reach(row.trip_id, last)
        bind.execute(
            sa.text('UPDATE pins SET cost_start_day = :f, cost_end_day = :l WHERE id = :id'),
            {'f': first, 'l': last, 'id': row.id},
        )
    with op.batch_alter_table('pins') as batch:
        batch.drop_column('cost_start_date')
        batch.drop_column('cost_end_date')

    starts = _trip_starts(bind)

    def trip_day(trip_id: int, day_of_month: int) -> int:
        if trip_id not in starts:
            return day_of_month
        start, count = starts[trip_id]
        for i in range(count):
            if (start + timedelta(days=i)).day == day_of_month:
                return i + 1
        try:
            return (start.replace(day=day_of_month) - start).days + 1
        except ValueError:
            return day_of_month

    _convert_availability(bind, trip_day)

    # A trip with things on its calendar but no dates gets a length that
    # covers them, so they stay on days it has.
    for row in bind.execute(sa.text('SELECT id FROM trips WHERE start_date IS NULL')).all():
        if row.id in last_day:
            bind.execute(sa.text('UPDATE trips SET length_days = :n WHERE id = :id'), {'n': last_day[row.id], 'id': row.id})


def downgrade() -> None:
    bind = op.get_bind()
    day_one = {
        row.id: _as_date(row.start_date) or _wall_clock(row.created_at).date()
        for row in bind.execute(sa.text('SELECT id, start_date, created_at FROM trips'))
    }

    def stamp(trip_id: int, minute: int) -> datetime:
        return datetime.combine(day_one[trip_id], datetime.min.time(), tzinfo=timezone.utc) + timedelta(minutes=minute)

    def on_day(trip_id: int, day: int) -> date:
        return day_one[trip_id] + timedelta(days=day - 1)

    for table in TIMED:
        op.add_column(table, sa.Column('starts_at', sa.DateTime(timezone=True), nullable=True))
        op.add_column(table, sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True))
        for row in bind.execute(sa.text(f'SELECT id, trip_id, start_min, end_min FROM {table}')).all():
            bind.execute(
                sa.text(f'UPDATE {table} SET starts_at = :s, ends_at = :e WHERE id = :id'),
                {'s': stamp(row.trip_id, row.start_min), 'e': stamp(row.trip_id, row.end_min), 'id': row.id},
            )
        with op.batch_alter_table(table) as batch:
            batch.alter_column('starts_at', existing_type=sa.DateTime(timezone=True), nullable=False)
            batch.alter_column('ends_at', existing_type=sa.DateTime(timezone=True), nullable=False)
            batch.drop_column('start_min')
            batch.drop_column('end_min')

    op.add_column('trip_day_places', sa.Column('date', sa.Date(), nullable=True))
    for row in bind.execute(sa.text('SELECT id, trip_id, day FROM trip_day_places')).all():
        bind.execute(sa.text('UPDATE trip_day_places SET date = :d WHERE id = :id'), {'d': on_day(row.trip_id, row.day), 'id': row.id})
    with op.batch_alter_table('trip_day_places') as batch:
        batch.drop_constraint('uq_trip_day_place_position', type_='unique')
        batch.drop_constraint('uq_trip_day_place_name', type_='unique')
        batch.alter_column('date', existing_type=sa.Date(), nullable=False)
        batch.drop_column('day')
        batch.create_unique_constraint('uq_trip_day_place_position', ['trip_id', 'date', 'position'])
        batch.create_unique_constraint('uq_trip_day_place_name', ['trip_id', 'date', 'name_key'])

    op.add_column('pins', sa.Column('cost_start_date', sa.Date(), nullable=True))
    op.add_column('pins', sa.Column('cost_end_date', sa.Date(), nullable=True))
    rows = bind.execute(
        sa.text('SELECT id, trip_id, cost_start_day, cost_end_day FROM pins WHERE cost_start_day IS NOT NULL')
    ).all()
    for row in rows:
        bind.execute(
            sa.text('UPDATE pins SET cost_start_date = :f, cost_end_date = :l WHERE id = :id'),
            {'f': on_day(row.trip_id, row.cost_start_day), 'l': on_day(row.trip_id, row.cost_end_day), 'id': row.id},
        )
    with op.batch_alter_table('pins') as batch:
        batch.drop_column('cost_start_day')
        batch.drop_column('cost_end_day')

    starts = _trip_starts(bind)

    def day_of_month(trip_id: int, day: int) -> int:
        if trip_id not in starts:
            return day
        return (starts[trip_id][0] + timedelta(days=day - 1)).day

    _convert_availability(bind, day_of_month)

    with op.batch_alter_table('trips') as batch:
        batch.drop_column('rough_month')
        batch.drop_column('length_days')
