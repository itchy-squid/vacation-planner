"""proposals and expenses

Revision ID: 9c1e40b7a2d5
Revises: 06ec26a6b612
Create Date: 2026-09-13 00:00:00.000000

Adds the eight columns and the one new enum value that
docs/features/proposals-and-expenses-feature-spec.md §1 describes, plus the
backfill that gives every pre-existing Contest a window.

Two dialect-specific notes, both deliberate:

* The Postgres `planstatus` ENUM type is a separate object from the column
  that uses it, so a new value needs ALTER TYPE ... ADD VALUE rather than
  just changing the model. SQLite stores the enum as a VARCHAR with a
  CHECK-free column (SQLAlchemy's Enum emits no constraint for a
  native-enum-less backend here), so it needs nothing at all — hence the
  dialect guard.

* `contests.starts_at`/`ends_at` are NOT NULL in app/models.py. They're
  added nullable, backfilled, and only then tightened — and the tightening
  is skipped on SQLite, which has no ALTER COLUMN and would need a full
  table rebuild that the circular plans<->contests foreign-key pair makes
  needlessly risky. SQLite here is only backend-ci.yml's throwaway
  "does upgrade head run" check against an empty database, so the looser
  column there costs nothing.
"""
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '9c1e40b7a2d5'
down_revision = '06ec26a6b612'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == 'postgresql'

    # ---- Costing: who a cost is split between, and how many people the
    # trip is costed for at all. ----
    op.add_column('trips', sa.Column('traveller_count', sa.Integer(), nullable=True))
    # Existing trips stay NULL, which the app reads as "fall back to the
    # contributor count" — so nothing has to be guessed here.
    op.add_column('pins', sa.Column('heads', sa.JSON(), nullable=False, server_default='[]'))
    op.add_column('travel_items', sa.Column('heads', sa.JSON(), nullable=False, server_default='[]'))

    # ---- Plans: the proposer's case, and per-placement overrides. ----
    op.add_column('plans', sa.Column('rationale', sa.Text(), nullable=False, server_default=''))
    op.add_column('plan_items', sa.Column('duration_minutes', sa.Integer(), nullable=True))
    op.add_column('plan_items', sa.Column('offset_minutes', sa.Integer(), nullable=True))

    # The server_defaults above exist only so the ALTER can fill existing
    # rows; app/models.py has no default, and leaving one behind would make
    # the schema drift from the model. Postgres can drop it in place;
    # SQLite can't, and doesn't matter (see the module docstring).
    if is_postgres:
        op.alter_column('pins', 'heads', server_default=None)
        op.alter_column('travel_items', 'heads', server_default=None)
        op.alter_column('plans', 'rationale', server_default=None)

    # ---- The new plan status. ----
    if is_postgres:
        # ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
        # PostgreSQL < 12; every version this project targets is 16, where
        # it can, so no autocommit dance is needed.
        op.execute("ALTER TYPE planstatus ADD VALUE IF NOT EXISTS 'draft'")

    # ---- The contest window. ----
    op.add_column('contests', sa.Column('starts_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('contests', sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True))

    # A contest created before this feature has no window of its own, but
    # its plans do: the hours it was always about are the span its options
    # cover. Deriving it here (rather than defaulting to something inert)
    # is what lets the new overlap rules treat old contests and new ones
    # identically.
    op.execute(
        """
        UPDATE contests
           SET starts_at = (SELECT MIN(p.starts_at) FROM plans p WHERE p.contest_id = contests.id),
               ends_at   = (SELECT MAX(p.ends_at)   FROM plans p WHERE p.contest_id = contests.id)
        """
    )

    # A contest with no plans at all shouldn't exist — Contest.plans
    # cascades and a contest is only ever created alongside its first
    # option — but a NOT NULL column can't be left to "shouldn't". Fall
    # back to the trip's own start, at midnight, or to the epoch for a trip
    # with no dates set yet (they're optional — see pages/TripSettings.jsx).
    empty = bind.execute(
        sa.text(
            "SELECT c.id, t.start_date FROM contests c"
            " JOIN trips t ON t.id = c.trip_id"
            " WHERE c.starts_at IS NULL"
        )
    ).all()
    for contest_id, start_date in empty:
        if start_date is None:
            moment = datetime(1970, 1, 1, tzinfo=timezone.utc)
        elif isinstance(start_date, str):  # SQLite hands dates back as text
            year, month, day = (int(part) for part in start_date.split('-'))
            moment = datetime(year, month, day, tzinfo=timezone.utc)
        else:
            moment = datetime(start_date.year, start_date.month, start_date.day, tzinfo=timezone.utc)
        bind.execute(
            sa.text("UPDATE contests SET starts_at = :m, ends_at = :m WHERE id = :i"),
            {"m": moment, "i": contest_id},
        )

    if is_postgres:
        op.alter_column('contests', 'starts_at', nullable=False)
        op.alter_column('contests', 'ends_at', nullable=False)


def downgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == 'postgresql'

    op.drop_column('contests', 'ends_at')
    op.drop_column('contests', 'starts_at')
    op.drop_column('plan_items', 'offset_minutes')
    op.drop_column('plan_items', 'duration_minutes')
    op.drop_column('plans', 'rationale')
    op.drop_column('travel_items', 'heads')
    op.drop_column('pins', 'heads')
    op.drop_column('trips', 'traveller_count')

    # Postgres has no ALTER TYPE ... DROP VALUE. Removing 'draft' means
    # rebuilding the type, which is only safe once no row still uses it —
    # so drop those rows first (a draft is private, unpublished work by
    # definition, and this downgrade is undoing the feature that created
    # it).
    if is_postgres:
        op.execute("DELETE FROM plans WHERE status = 'draft'")
        op.execute("ALTER TYPE planstatus RENAME TO planstatus_old")
        op.execute("CREATE TYPE planstatus AS ENUM ('placed', 'pencilled', 'contested', 'locked')")
        op.execute(
            "ALTER TABLE plans ALTER COLUMN status TYPE planstatus"
            " USING status::text::planstatus"
        )
        op.execute("DROP TYPE planstatus_old")
