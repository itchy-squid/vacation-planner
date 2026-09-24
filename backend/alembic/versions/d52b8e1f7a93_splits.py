"""splits: the group splitting up becomes a record

Revision ID: d52b8e1f7a93
Revises: a91d4c7e2f58
Create Date: 2026-09-24 12:00:00.000000

Until now a split was inferred: every plan and contest carried a `party`
(traveler ids read through `party_mode`), and two plans could share hours
when their parties didn't share a person. Every screen had to rediscover
where the group had split, and nothing could act on a split as a whole —
there was no "bring everyone back", only re-partying one plan at a time.

This revision makes it a record (see app/models.py Split, SplitBranch and
app/splits.py):

- `splits` (a trip's hours when the group is apart) and `split_branches`
  (one row per group: its travelers, and whether people added later join
  it).
- plans and contests gain `branch_id`; None is everyone.
- plans and contests lose `party` and `party_mode`.

Backfill, per trip: plans that aren't for everyone are clustered by
overlapping hours (drafts left out — they claim no time). Each cluster is
one split spanning its plans, with one branch per distinct party in it.
Under the old overlap rule no plan for everyone can overlap such a cluster,
so rule 2 in app/splits.py holds from the start. Anyone in none of a
cluster's parties was simply free then; if no party took newcomers, they
get a branch of their own so the lanes still say where everyone is. A
cluster that turns out to be one party covering the whole roster isn't a
split at all, and its plans become plans for everyone. Contests and drafts
join the branch with their party whose split contains their hours.

The data steps use plain SELECT/UPDATE with JSON handled in Python, so the
same code serves SQLite and Postgres, as in a91d4c7e2f58.

The downgrade writes each branch back onto its plans and contests as a
party ("only" its travelers, or "except" everyone else for the branch that
took newcomers) and drops the new tables.
"""
import json
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd52b8e1f7a93'
down_revision = 'a91d4c7e2f58'
branch_labels = None
depends_on = None


def _load(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    return json.loads(value)


def _aware(value: datetime) -> datetime:
    # Aware on Postgres, naive on SQLite; the app's convention is that
    # both mean trip-local wall-clock tagged UTC (app/tripclock.py).
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


_plans = sa.table(
    'plans',
    sa.column('id', sa.Integer), sa.column('trip_id', sa.Integer), sa.column('status', sa.String),
    sa.column('starts_at', sa.DateTime(timezone=True)), sa.column('ends_at', sa.DateTime(timezone=True)),
    sa.column('party', sa.JSON), sa.column('party_mode', sa.String), sa.column('branch_id', sa.Integer),
)
_contests = sa.table(
    'contests',
    sa.column('id', sa.Integer), sa.column('trip_id', sa.Integer),
    sa.column('starts_at', sa.DateTime(timezone=True)), sa.column('ends_at', sa.DateTime(timezone=True)),
    sa.column('party', sa.JSON), sa.column('party_mode', sa.String), sa.column('branch_id', sa.Integer),
)
_splits = sa.table(
    'splits',
    sa.column('id', sa.Integer), sa.column('trip_id', sa.Integer),
    sa.column('starts_at', sa.DateTime(timezone=True)), sa.column('ends_at', sa.DateTime(timezone=True)),
    sa.column('created_at', sa.DateTime(timezone=True)),
)
_branches = sa.table(
    'split_branches',
    sa.column('id', sa.Integer), sa.column('split_id', sa.Integer), sa.column('label', sa.String),
    sa.column('position', sa.Integer), sa.column('traveler_ids', sa.JSON), sa.column('takes_newcomers', sa.Boolean),
)


def upgrade() -> None:
    op.create_table(
        'splits',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('trip_id', sa.Integer(), sa.ForeignKey('trips.id', ondelete='CASCADE'), nullable=False),
        sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ends_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_by_id', sa.Integer(), sa.ForeignKey('contributors.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_splits_trip_id', 'splits', ['trip_id'])
    op.create_table(
        'split_branches',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('split_id', sa.Integer(), sa.ForeignKey('splits.id', ondelete='CASCADE'), nullable=False),
        sa.Column('label', sa.String(length=200), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('traveler_ids', sa.JSON(), nullable=False),
        sa.Column('takes_newcomers', sa.Boolean(), nullable=False),
    )
    op.create_index('ix_split_branches_split_id', 'split_branches', ['split_id'])

    for table in ('plans', 'contests'):
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column('branch_id', sa.Integer(), nullable=True))
            batch.create_foreign_key(f'fk_{table}_branch_id', 'split_branches', ['branch_id'], ['id'], ondelete='SET NULL')
            batch.create_index(f'ix_{table}_branch_id', ['branch_id'])

    _backfill(op.get_bind())

    for table in ('plans', 'contests'):
        with op.batch_alter_table(table) as batch:
            batch.drop_column('party_mode')
            batch.drop_column('party')


def _backfill(bind) -> None:
    now = datetime.now(timezone.utc)
    roster: dict[int, set[int]] = {}
    for tid, trip_id in bind.execute(sa.text("SELECT id, trip_id FROM travelers")).all():
        roster.setdefault(trip_id, set()).add(tid)

    def key(row):
        mode = row.party_mode or 'except'
        return (mode, tuple(sorted(_load(row.party))))

    def members(k, trip_id):
        mode, ids = k
        everyone = roster.get(trip_id, set())
        return (everyone - set(ids)) if mode == 'except' else (set(ids) & everyone)

    def is_everyone(k):
        return k == ('except', ())

    plans = bind.execute(sa.select(_plans)).all()
    contests = bind.execute(sa.select(_contests)).all()

    # (trip_id, key) -> [(start, end, branch_id)] so contests and drafts can
    # find the branch whose split holds their hours.
    homes: dict[tuple[int, tuple], list[tuple[datetime, datetime, int]]] = {}

    by_trip: dict[int, list] = {}
    for row in plans:
        if row.status != 'draft' and not is_everyone(key(row)):
            by_trip.setdefault(row.trip_id, []).append(row)

    for trip_id, rows in by_trip.items():
        rows.sort(key=lambda r: (_aware(r.starts_at), _aware(r.ends_at)))
        clusters: list[list] = []
        end = None
        for row in rows:
            if clusters and end is not None and _aware(row.starts_at) < end:
                clusters[-1].append(row)
                end = max(end, _aware(row.ends_at))
            else:
                clusters.append([row])
                end = _aware(row.ends_at)

        everyone = roster.get(trip_id, set())
        for cluster in clusters:
            groups: dict[tuple, list] = {}
            for row in cluster:
                groups.setdefault(key(row), []).append(row)
            ordered = sorted(groups, key=lambda k: (min(members(k, trip_id) or {10**12}), k))
            specs = [(k, sorted(members(k, trip_id)), k[0] == 'except') for k in ordered]
            covered = set().union(*(set(m) for _, m, _ in specs))
            if not any(takes for _, _, takes in specs) and everyone - covered:
                specs.append((None, sorted(everyone - covered), False))
            if len(specs) < 2:
                # One party that turns out to be everyone: not a split.
                continue

            starts = min(_aware(r.starts_at) for r in cluster)
            ends = max(_aware(r.ends_at) for r in cluster)
            split_id = bind.execute(
                _splits.insert().returning(_splits.c.id).values(trip_id=trip_id, starts_at=starts, ends_at=ends, created_at=now)
            ).scalar_one()
            for position, (k, traveler_ids, takes) in enumerate(specs):
                branch_id = bind.execute(
                    _branches.insert().returning(_branches.c.id).values(
                        split_id=split_id, label='', position=position,
                        traveler_ids=traveler_ids, takes_newcomers=takes,
                    )
                ).scalar_one()
                if k is None:
                    continue
                homes.setdefault((trip_id, k), []).append((starts, ends, branch_id))
                ids = [r.id for r in groups[k]]
                bind.execute(_plans.update().where(_plans.c.id.in_(ids)).values(branch_id=branch_id))

    def home_for(row) -> int | None:
        for starts, ends, branch_id in homes.get((row.trip_id, key(row)), []):
            if starts <= _aware(row.starts_at) and _aware(row.ends_at) <= ends:
                return branch_id
        return None

    for row in contests:
        if not is_everyone(key(row)):
            branch_id = home_for(row)
            if branch_id is not None:
                bind.execute(_contests.update().where(_contests.c.id == row.id).values(branch_id=branch_id))
    for row in plans:
        if row.status == 'draft' and not is_everyone(key(row)):
            branch_id = home_for(row)
            if branch_id is not None:
                bind.execute(_plans.update().where(_plans.c.id == row.id).values(branch_id=branch_id))


def downgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == 'postgresql'

    for table in ('plans', 'contests'):
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column('party', sa.JSON(), nullable=False, server_default='[]'))
            batch.add_column(sa.Column('party_mode', sa.String(length=8), nullable=False, server_default='except'))

    roster: dict[int, set[int]] = {}
    for tid, trip_id in bind.execute(sa.text("SELECT id, trip_id FROM travelers")).all():
        roster.setdefault(trip_id, set()).add(tid)
    branches = bind.execute(
        sa.text(
            "SELECT b.id, s.trip_id, b.traveler_ids, b.takes_newcomers"
            " FROM split_branches b JOIN splits s ON s.id = b.split_id"
        )
    ).all()
    for branch_id, trip_id, traveler_ids, takes in branches:
        ids = set(_load(traveler_ids))
        if takes:
            party, mode = sorted(roster.get(trip_id, set()) - ids), 'except'
        else:
            party, mode = sorted(ids), 'only'
        for table in ('plans', 'contests'):
            bind.execute(
                sa.text(f"UPDATE {table} SET party = :p, party_mode = :m WHERE branch_id = :b"),
                {"p": json.dumps(party), "m": mode, "b": branch_id},
            )

    for table in ('plans', 'contests'):
        with op.batch_alter_table(table) as batch:
            batch.drop_index(f'ix_{table}_branch_id')
            batch.drop_constraint(f'fk_{table}_branch_id', type_='foreignkey')
            batch.drop_column('branch_id')
        if is_postgres:
            op.alter_column(table, 'party', server_default=None)
            op.alter_column(table, 'party_mode', server_default=None)

    op.drop_index('ix_split_branches_split_id', table_name='split_branches')
    op.drop_table('split_branches')
    op.drop_index('ix_splits_trip_id', table_name='splits')
    op.drop_table('splits')
