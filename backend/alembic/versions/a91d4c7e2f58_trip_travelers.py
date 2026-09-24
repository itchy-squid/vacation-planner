"""trip travelers, per-person prices, and who newcomers join

Revision ID: a91d4c7e2f58
Revises: f3a8d2c61b90
Create Date: 2026-09-23 18:00:00.000000

Travelers are the people going on a trip, which is not the same list as
the people on the app: a child or a grandparent goes without ever signing
in, and a planner can help without going. See app/models.py Traveler.

- A `travelers` table. Every existing member becomes a traveler, linked to
  them, in join order. Where a trip's old traveller_count was higher than
  its member count, the difference is added as placeholder travelers
  ("Traveler 5", ...) so every cost split keeps its headcount.
- pins/travel_items.heads and plans/contests.party are rewritten from
  contributor ids to the matching traveler ids.
- plans/contests gain party_mode. [] stays everyone ("except" nobody); a
  non-empty party was always an exact list, so it becomes "only".
- pins/travel_items gain cost_basis. Every existing price was a total, so
  existing rows are "group" and no total moves; only new items default to
  "per_head".
- trip_invites gain traveler_id, for a link made for one listed traveler.
- trips.traveller_count goes.

The data steps run through plain SELECT/UPDATE with JSON handled in
Python, so the same code serves SQLite and Postgres.

The downgrade maps travelers back to their members, drops anyone without
an account from heads and parties, turns "except" parties back into the
exact list they stood for, deletes plans and contests left for nobody, and
restores traveller_count as the number of travelers.
"""
import json
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a91d4c7e2f58'
down_revision = 'f3a8d2c61b90'
branch_labels = None
depends_on = None

_TINTS = ("var(--who-1)", "var(--who-2)", "var(--who-3)", "var(--who-4)")


def _load(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    return json.loads(value)


def _remap_lists(bind, table: str, column: str, mapping: dict[int, int]) -> None:
    rows = bind.execute(sa.text(f"SELECT id, {column} FROM {table}")).all()
    for row_id, value in rows:
        ids = _load(value)
        if not ids:
            continue
        new = sorted({mapping[i] for i in ids if i in mapping})
        bind.execute(
            sa.text(f"UPDATE {table} SET {column} = :v WHERE id = :id"),
            {"v": json.dumps(new), "id": row_id},
        )


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == 'postgresql'

    op.create_table(
        'travelers',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('trip_id', sa.Integer(), sa.ForeignKey('trips.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('initial', sa.String(length=4), nullable=False),
        sa.Column('tint', sa.String(length=32), nullable=False),
        sa.Column('contributor_id', sa.Integer(), sa.ForeignKey('contributors.id', ondelete='SET NULL'), nullable=True),
        sa.Column('paid_by_id', sa.Integer(), sa.ForeignKey('travelers.id', ondelete='SET NULL'), nullable=True),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('trip_id', 'contributor_id', name='uq_traveler_trip_contributor'),
    )
    op.create_index('ix_travelers_trip_id', 'travelers', ['trip_id'])

    op.add_column('pins', sa.Column('cost_basis', sa.String(length=16), nullable=False, server_default='group'))
    op.add_column('travel_items', sa.Column('cost_basis', sa.String(length=16), nullable=False, server_default='group'))
    op.add_column('plans', sa.Column('party_mode', sa.String(length=8), nullable=False, server_default='except'))
    op.add_column('contests', sa.Column('party_mode', sa.String(length=8), nullable=False, server_default='except'))
    with op.batch_alter_table('trip_invites') as batch:
        batch.add_column(sa.Column('traveler_id', sa.Integer(), nullable=True))
        batch.create_foreign_key('fk_trip_invites_traveler_id', 'travelers', ['traveler_id'], ['id'], ondelete='CASCADE')

    # ---- one traveler per member, plus placeholders for the old count ----
    now = datetime.now(timezone.utc)
    mapping: dict[int, int] = {}
    trips = bind.execute(sa.text("SELECT id, traveller_count FROM trips ORDER BY id")).all()
    travelers = sa.table(
        'travelers',
        sa.column('id', sa.Integer), sa.column('trip_id', sa.Integer), sa.column('name', sa.String),
        sa.column('initial', sa.String), sa.column('tint', sa.String), sa.column('contributor_id', sa.Integer),
        sa.column('position', sa.Integer), sa.column('created_at', sa.DateTime(timezone=True)),
    )
    for trip_id, old_count in trips:
        members = bind.execute(
            sa.text(
                "SELECT id, display_name, initial, tint FROM contributors"
                " WHERE trip_id = :t ORDER BY joined_at, id"
            ),
            {"t": trip_id},
        ).all()
        position = 0
        for cid, name, initial, tint in members:
            new_id = bind.execute(
                travelers.insert().returning(travelers.c.id).values(
                    trip_id=trip_id, name=name, initial=initial, tint=tint,
                    contributor_id=cid, position=position, created_at=now,
                )
            ).scalar_one()
            mapping[cid] = new_id
            position += 1
        for n in range(position, old_count or 0):
            bind.execute(
                travelers.insert().values(
                    trip_id=trip_id, name=f"Traveler {n + 1}", initial=str(n + 1)[:4],
                    tint=_TINTS[n % len(_TINTS)], contributor_id=None, position=n, created_at=now,
                )
            )

    # ---- contributor ids become traveler ids ----
    for table, column in (('pins', 'heads'), ('travel_items', 'heads'), ('plans', 'party'), ('contests', 'party')):
        _remap_lists(bind, table, column, mapping)
    for table in ('plans', 'contests'):
        for row_id, value in bind.execute(sa.text(f"SELECT id, party FROM {table}")).all():
            if _load(value):
                bind.execute(sa.text(f"UPDATE {table} SET party_mode = 'only' WHERE id = :id"), {"id": row_id})

    with op.batch_alter_table('trips') as batch:
        batch.drop_column('traveller_count')

    if is_postgres:
        for table, column in (('pins', 'cost_basis'), ('travel_items', 'cost_basis'), ('plans', 'party_mode'), ('contests', 'party_mode')):
            op.alter_column(table, column, server_default=None)


def downgrade() -> None:
    bind = op.get_bind()

    op.add_column('trips', sa.Column('traveller_count', sa.Integer(), nullable=True))
    for (trip_id,) in bind.execute(sa.text("SELECT id FROM trips")).all():
        count = bind.execute(sa.text("SELECT COUNT(*) FROM travelers WHERE trip_id = :t"), {"t": trip_id}).scalar()
        bind.execute(sa.text("UPDATE trips SET traveller_count = :c WHERE id = :t"), {"c": count, "t": trip_id})

    rows = bind.execute(sa.text("SELECT id, trip_id, contributor_id FROM travelers")).all()
    to_member = {tid: cid for tid, _, cid in rows if cid is not None}
    roster: dict[int, set[int]] = {}
    for tid, trip_id, _ in rows:
        roster.setdefault(trip_id, set()).add(tid)

    for table, column in (('pins', 'heads'), ('travel_items', 'heads')):
        _remap_lists(bind, table, column, to_member)

    # A party back to the exact member list it stood for; [] stays everyone.
    for table in ('contests', 'plans'):
        for row_id, trip_id, value, mode in bind.execute(sa.text(f"SELECT id, trip_id, party, party_mode FROM {table}")).all():
            ids = set(_load(value))
            if mode == 'except' and not ids:
                continue
            members = (roster.get(trip_id, set()) - ids) if mode == 'except' else ids
            mapped = sorted({to_member[t] for t in members if t in to_member})
            if not mapped:
                bind.execute(sa.text(f"DELETE FROM {table} WHERE id = :id"), {"id": row_id})
                continue
            bind.execute(sa.text(f"UPDATE {table} SET party = :v WHERE id = :id"), {"v": json.dumps(mapped), "id": row_id})
    # SQLite doesn't enforce the cascade: clear options of contests deleted
    # above so no plan points at a contest that's gone.
    bind.execute(sa.text("DELETE FROM plans WHERE contest_id IS NOT NULL AND contest_id NOT IN (SELECT id FROM contests)"))

    with op.batch_alter_table('trip_invites') as batch:
        batch.drop_constraint('fk_trip_invites_traveler_id', type_='foreignkey')
        batch.drop_column('traveler_id')
    op.drop_column('contests', 'party_mode')
    op.drop_column('plans', 'party_mode')
    op.drop_column('travel_items', 'cost_basis')
    op.drop_column('pins', 'cost_basis')
    op.drop_index('ix_travelers_trip_id', table_name='travelers')
    op.drop_table('travelers')
