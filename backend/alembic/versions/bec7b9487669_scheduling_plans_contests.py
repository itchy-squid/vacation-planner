"""replace block/candidate-set scheduling with plan/contest scheduling

Revision ID: bec7b9487669
Revises: 4f8adb218fa7
Create Date: 2026-09-08 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'bec7b9487669'
down_revision = '4f8adb218fa7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Dev-only schema — there's no production data to preserve (see
    # app/seed.py). This replaces the old Block/CandidateSet/
    # CandidateSetStop/Vote scheduling model with the Plan/PlanItem/
    # Contest/Vote/TravelItem model from
    # docs/features/scheduling-feature-spec.md, so — same as
    # 4f8adb218fa7 — it's a full rebuild rather than an in-place ALTER.
    # Trip/Contributor/Pin/AvailabilityRule/AvailabilityOverride are
    # unchanged in shape but still get dropped and recreated here because
    # they're on the same dependency chain as the tables that are changing.
    op.drop_table('comments')
    op.drop_table('votes')
    op.drop_table('candidate_set_stops')
    op.drop_table('availability_rules')
    op.drop_table('availability_overrides')
    op.drop_table('pins')
    op.drop_table('candidate_sets')
    op.drop_table('contributors')
    op.drop_table('blocks')
    op.drop_table('trips')

    op.create_table('trips',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('region_line', sa.String(length=300), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=True),
    sa.Column('end_date', sa.Date(), nullable=True),
    sa.Column('phase', postgresql.ENUM('ideation', 'scheduling', 'locked', name='tripphase', create_type=False), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('contributors',
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
    sa.UniqueConstraint('trip_id', 'email', name='uq_contributor_trip_email')
    )
    op.create_table('pins',
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
    sa.ForeignKeyConstraint(['added_by_id'], ['contributors.id'], ),
    sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('availability_overrides',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('pin_id', sa.Integer(), nullable=False),
    sa.Column('day', sa.Integer(), nullable=False),
    sa.Column('band', sa.String(length=8), nullable=False),
    sa.Column('created_by_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by_id'], ['contributors.id'], ),
    sa.ForeignKeyConstraint(['pin_id'], ['pins.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('pin_id', 'day', 'band', name='uq_override_pin_day_band')
    )
    op.create_table('availability_rules',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('pin_id', sa.Integer(), nullable=False),
    sa.Column('days', sa.JSON(), nullable=False),
    sa.Column('bands', sa.JSON(), nullable=False),
    sa.Column('reasons', sa.JSON(), nullable=False),
    sa.ForeignKeyConstraint(['pin_id'], ['pins.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('pin_id')
    )
    op.create_table('travel_items',
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
    sa.ForeignKeyConstraint(['added_by_id'], ['contributors.id'], ),
    sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('plans',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('trip_id', sa.Integer(), nullable=False),
    sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ends_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('label', sa.String(length=200), nullable=False),
    sa.Column('color', sa.String(length=32), nullable=False),
    sa.Column('status', postgresql.ENUM('placed', 'pencilled', 'contested', 'locked', name='planstatus', create_type=True), nullable=False),
    sa.Column('contest_id', sa.Integer(), nullable=True),
    sa.Column('created_by_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    # Circular with contests.winning_plan_id — contests is created after
    # this table, so this FK is deferred via use_alter (same pattern the
    # old blocks.locked_set_id -> candidate_sets.id FK used).
    sa.ForeignKeyConstraint(['contest_id'], ['contests.id'], ondelete='CASCADE', use_alter=True),
    sa.ForeignKeyConstraint(['created_by_id'], ['contributors.id'], ),
    sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('contests',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('trip_id', sa.Integer(), nullable=False),
    sa.Column('status', postgresql.ENUM('open', 'resolved', name='conteststatus', create_type=True), nullable=False),
    sa.Column('winning_plan_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['winning_plan_id'], ['plans.id'], use_alter=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('plan_items',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('plan_id', sa.Integer(), nullable=False),
    sa.Column('pin_id', sa.Integer(), nullable=True),
    sa.Column('travel_item_id', sa.Integer(), nullable=True),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.CheckConstraint('(pin_id IS NOT NULL) != (travel_item_id IS NOT NULL)', name='ck_plan_item_exactly_one_target'),
    sa.ForeignKeyConstraint(['pin_id'], ['pins.id'], ),
    sa.ForeignKeyConstraint(['plan_id'], ['plans.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['travel_item_id'], ['travel_items.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('votes',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('contest_id', sa.Integer(), nullable=False),
    sa.Column('plan_id', sa.Integer(), nullable=False),
    sa.Column('contributor_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['contest_id'], ['contests.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['contributor_id'], ['contributors.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['plan_id'], ['plans.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('contest_id', 'contributor_id', name='uq_vote_contest_contributor')
    )
    op.create_table('comments',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('pin_id', sa.Integer(), nullable=True),
    sa.Column('plan_id', sa.Integer(), nullable=True),
    sa.Column('contributor_id', sa.Integer(), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['contributor_id'], ['contributors.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['pin_id'], ['pins.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['plan_id'], ['plans.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    # Reverses to the Block/CandidateSet table shapes from 4f8adb218fa7.
    # There's no meaningful way to turn a Plan/Contest back into a Block/
    # CandidateSet, so — same as upgrade() — this is a full rebuild, empty
    # either direction.
    op.drop_table('comments')
    op.drop_table('votes')
    op.drop_table('plan_items')
    op.drop_table('contests')
    op.drop_table('plans')
    op.drop_table('travel_items')
    op.drop_table('availability_rules')
    op.drop_table('availability_overrides')
    op.drop_table('pins')
    op.drop_table('contributors')
    op.drop_table('trips')

    op.execute('DROP TYPE IF EXISTS planstatus')
    op.execute('DROP TYPE IF EXISTS conteststatus')

    op.create_table('trips',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('region_line', sa.String(length=300), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=True),
    sa.Column('end_date', sa.Date(), nullable=True),
    sa.Column('phase', postgresql.ENUM('ideation', 'scheduling', 'locked', name='tripphase', create_type=False), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('blocks',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('trip_id', sa.Integer(), nullable=False),
    sa.Column('day_index', sa.Integer(), nullable=False),
    sa.Column('start_minute', sa.Integer(), nullable=False),
    sa.Column('end_minute', sa.Integer(), nullable=False),
    sa.Column('region', sa.String(length=120), nullable=False),
    sa.Column('status', postgresql.ENUM('empty', 'pencilled', 'placed', 'contested', 'locked', name='blockstatus', create_type=False), nullable=False),
    sa.Column('locked_set_id', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['locked_set_id'], ['candidate_sets.id'], use_alter=True),
    sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('contributors',
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
    sa.UniqueConstraint('trip_id', 'email', name='uq_contributor_trip_email')
    )
    op.create_table('candidate_sets',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('block_id', sa.Integer(), nullable=False),
    sa.Column('key', sa.String(length=8), nullable=False),
    sa.Column('label', sa.String(length=120), nullable=False),
    sa.Column('color', sa.String(length=32), nullable=False),
    sa.Column('is_draft', sa.Boolean(), nullable=False),
    sa.Column('created_by_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['block_id'], ['blocks.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['created_by_id'], ['contributors.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('pins',
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
    sa.ForeignKeyConstraint(['added_by_id'], ['contributors.id'], ),
    sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('availability_overrides',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('pin_id', sa.Integer(), nullable=False),
    sa.Column('day', sa.Integer(), nullable=False),
    sa.Column('band', sa.String(length=8), nullable=False),
    sa.Column('created_by_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by_id'], ['contributors.id'], ),
    sa.ForeignKeyConstraint(['pin_id'], ['pins.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('pin_id', 'day', 'band', name='uq_override_pin_day_band')
    )
    op.create_table('availability_rules',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('pin_id', sa.Integer(), nullable=False),
    sa.Column('days', sa.JSON(), nullable=False),
    sa.Column('bands', sa.JSON(), nullable=False),
    sa.Column('reasons', sa.JSON(), nullable=False),
    sa.ForeignKeyConstraint(['pin_id'], ['pins.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('pin_id')
    )
    op.create_table('candidate_set_stops',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('candidate_set_id', sa.Integer(), nullable=False),
    sa.Column('pin_id', sa.Integer(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['candidate_set_id'], ['candidate_sets.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['pin_id'], ['pins.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('candidate_set_id', 'pin_id', name='uq_set_stop_pin')
    )
    op.create_table('comments',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('pin_id', sa.Integer(), nullable=True),
    sa.Column('candidate_set_id', sa.Integer(), nullable=True),
    sa.Column('contributor_id', sa.Integer(), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['candidate_set_id'], ['candidate_sets.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['contributor_id'], ['contributors.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['pin_id'], ['pins.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('votes',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('block_id', sa.Integer(), nullable=False),
    sa.Column('candidate_set_id', sa.Integer(), nullable=False),
    sa.Column('contributor_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['block_id'], ['blocks.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['candidate_set_id'], ['candidate_sets.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['contributor_id'], ['contributors.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('block_id', 'contributor_id', name='uq_vote_block_contributor')
    )
