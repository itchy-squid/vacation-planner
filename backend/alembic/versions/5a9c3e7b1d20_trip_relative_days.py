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
  `cost_end_day`, numbered the same way.

Each row is converted against its trip's start_date. A trip without one
can't have had places for a day (the API refused them), but nothing stopped
a plan; for such a trip the earliest date on its calendar is taken as day 1,
and the trip is given a length that covers everything on it.

The downgrade converts back the same way, against the trip's start_date,
or its creation date for a trip that has none.
"""
from datetime import date, datetime, timedelta, timezone

from alembic import op
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

    with op.batch_alter_table('trips') as batch:
        batch.drop_column('rough_month')
        batch.drop_column('length_days')
