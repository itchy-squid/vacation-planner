"""initial schema

Revision ID: 06ec26a6b612
Revises:
Create Date: 2026-09-09 00:00:00.000000

Fresh baseline replacing the prior four migrations (c20d0f371d3d,
b3eefc046a80, 4f8adb218fa7, bec7b9487669) — there is no production data to
preserve yet (this is the first real deploy), so those are squashed into a
single migration that creates the schema exactly as app/models.py describes
it today, rather than replaying the Block/CandidateSet -> Plan/Contest
rebuild history that got us here. See docs/features/scheduling-feature-spec.md
for the current data model.

This also fixes a real bug the old migrations carried forward: the circular
FK pair (plans.contest_id <-> contests.winning_plan_id) was declared with
use_alter=True *inside* op.create_table(...)'s ForeignKeyConstraint list.
use_alter tells SQLAlchemy to defer that constraint to a later ALTER TABLE
rather than emit it inline — appropriate for a circular pair — but nothing
ever issued the deferred ALTER, so both foreign keys were silently never
created. This migration adds them explicitly via op.create_foreign_key(...)
after both tables exist. (Verified: previously "describe plans" /
"describe contests" on a database built from the old migrations showed
neither FK present.)
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '06ec26a6b612'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'trips',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('region_line', sa.String(length=300), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=True),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('phase', sa.Enum('ideation', 'scheduling', 'locked', name='tripphase'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'contributors',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('trip_id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=320), nullable=False),
        sa.Column('display_name', sa.String(length=120), nullable=False),
        sa.Column('initial', sa.String(length=4), nullable=False),
        sa.Column('tint', sa.String(length=32), nullable=False),
        sa.Column('is_owner', sa.Boolean(), nullable=False),
        sa.Column('joined_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('trip_id', 'email', name='uq_contributor_trip_email'),
    )
    op.create_table(
        'pins',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('trip_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('short', sa.String(length=60), nullable=False),
        sa.Column('place', sa.String(length=200), nullable=False),
        sa.Column('region', sa.String(length=120), nullable=False),
        sa.Column('lat', sa.Float(), nullable=True),
        sa.Column('lng', sa.Float(), nullable=True),
        sa.Column('duration_minutes', sa.Integer(), nullable=False),
        sa.Column('cost_cents', sa.Integer(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=False),
        sa.Column('link', sa.String(length=500), nullable=False),
        sa.Column('tags', sa.JSON(), nullable=False),
        sa.Column('photo_url', sa.String(length=1000), nullable=True),
        sa.Column('photo_source_url', sa.String(length=1000), nullable=True),
        sa.Column('added_by_id', sa.Integer(), nullable=True),
        sa.Column('added_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['added_by_id'], ['contributors.id']),
        sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'availability_rules',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('pin_id', sa.Integer(), nullable=False),
        sa.Column('days', sa.JSON(), nullable=False),
        sa.Column('bands', sa.JSON(), nullable=False),
        sa.Column('reasons', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['pin_id'], ['pins.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('pin_id'),
    )
    op.create_table(
        'availability_overrides',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('pin_id', sa.Integer(), nullable=False),
        sa.Column('day', sa.Integer(), nullable=False),
        sa.Column('band', sa.String(length=8), nullable=False),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['created_by_id'], ['contributors.id']),
        sa.ForeignKeyConstraint(['pin_id'], ['pins.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('pin_id', 'day', 'band', name='uq_override_pin_day_band'),
    )
    op.create_table(
        'travel_items',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('trip_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('kind', sa.String(length=20), nullable=False),
        sa.Column('duration_minutes', sa.Integer(), nullable=False),
        sa.Column('cost_cents', sa.Integer(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=False),
        sa.Column('link', sa.String(length=500), nullable=False),
        sa.Column('added_by_id', sa.Integer(), nullable=True),
        sa.Column('added_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['added_by_id'], ['contributors.id']),
        sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'plans',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('trip_id', sa.Integer(), nullable=False),
        sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ends_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('label', sa.String(length=200), nullable=False),
        sa.Column('color', sa.String(length=32), nullable=False),
        sa.Column('status', sa.Enum('placed', 'pencilled', 'contested', 'locked', name='planstatus'), nullable=False),
        # contest_id -> contests.id is added below via a separate
        # create_foreign_key, once the contests table exists (see module
        # docstring — this is the circular FK half of the pair).
        sa.Column('contest_id', sa.Integer(), nullable=True),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['created_by_id'], ['contributors.id']),
        sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'contests',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('trip_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.Enum('open', 'resolved', name='conteststatus'), nullable=False),
        # winning_plan_id -> plans.id — the other half of the circular pair.
        sa.Column('winning_plan_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    # Both tables now exist — add the circular FK pair. batch_alter_table
    # is a plain ALTER TABLE on Postgres, but SQLite has no ALTER-based way
    # to add a constraint at all (needed for the backend-ci.yml sanity
    # check, which runs this migration against a throwaway SQLite db) —
    # batch mode is the portable way to express this on both.
    with op.batch_alter_table('plans') as batch_op:
        batch_op.create_foreign_key(
            'fk_plans_contest_id_contests', 'contests', ['contest_id'], ['id'], ondelete='CASCADE'
        )
    with op.batch_alter_table('contests') as batch_op:
        batch_op.create_foreign_key(
            'fk_contests_winning_plan_id_plans', 'plans', ['winning_plan_id'], ['id']
        )
    op.create_table(
        'plan_items',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('plan_id', sa.Integer(), nullable=False),
        sa.Column('pin_id', sa.Integer(), nullable=True),
        sa.Column('travel_item_id', sa.Integer(), nullable=True),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.CheckConstraint(
            '(pin_id IS NOT NULL) != (travel_item_id IS NOT NULL)', name='ck_plan_item_exactly_one_target'
        ),
        sa.ForeignKeyConstraint(['pin_id'], ['pins.id']),
        sa.ForeignKeyConstraint(['plan_id'], ['plans.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['travel_item_id'], ['travel_items.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'votes',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('contest_id', sa.Integer(), nullable=False),
        sa.Column('plan_id', sa.Integer(), nullable=False),
        sa.Column('contributor_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['contest_id'], ['contests.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['contributor_id'], ['contributors.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['plan_id'], ['plans.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('contest_id', 'contributor_id', name='uq_vote_contest_contributor'),
    )
    op.create_table(
        'comments',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('pin_id', sa.Integer(), nullable=True),
        sa.Column('plan_id', sa.Integer(), nullable=True),
        sa.Column('contributor_id', sa.Integer(), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['contributor_id'], ['contributors.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['pin_id'], ['pins.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['plan_id'], ['plans.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('comments')
    op.drop_table('votes')
    op.drop_table('plan_items')
    # Drop the circular FK pair before dropping plans/contests themselves.
    with op.batch_alter_table('contests') as batch_op:
        batch_op.drop_constraint('fk_contests_winning_plan_id_plans', type_='foreignkey')
    with op.batch_alter_table('plans') as batch_op:
        batch_op.drop_constraint('fk_plans_contest_id_contests', type_='foreignkey')
    op.drop_table('contests')
    op.drop_table('plans')
    op.drop_table('travel_items')
    op.drop_table('availability_overrides')
    op.drop_table('availability_rules')
    op.drop_table('pins')
    op.drop_table('contributors')
    op.drop_table('trips')
    # Postgres ENUM types are separate objects from the columns that use
    # them — dropping the tables above doesn't drop the types themselves.
    # (DROP TYPE is Postgres-only syntax; SQLite — used only for the
    # backend-ci.yml upgrade-head sanity check, which never downgrades —
    # has no such statement and no such leftover object.)
    if op.get_bind().dialect.name == 'postgresql':
        op.execute('DROP TYPE IF EXISTS planstatus')
        op.execute('DROP TYPE IF EXISTS conteststatus')
        op.execute('DROP TYPE IF EXISTS tripphase')
