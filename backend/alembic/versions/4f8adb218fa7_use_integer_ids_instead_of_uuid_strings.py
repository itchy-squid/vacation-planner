"""use integer ids instead of uuid strings

Revision ID: 4f8adb218fa7
Revises: b3eefc046a80
Create Date: 2026-09-06 21:23:34.570459

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = '4f8adb218fa7'
down_revision = 'b3eefc046a80'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Dev-only schema — there's no production data to preserve (see
    # app/seed.py: "Not used in production — Azure Postgres starts empty").
    # Switching every primary/foreign key from a UUID string to a plain
    # autoincrementing integer is a full rebuild, not an in-place ALTER
    # (an existing UUID value can't cast to an integer), so this drops and
    # recreates every table with the same shape as
    # c20d0f371d3d + b3eefc046a80 combined, just with int ids.
    op.drop_table('votes')
    op.drop_table('comments')
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


def downgrade() -> None:
    # Reverses to the pre-int-id table shapes. There's no meaningful way to
    # turn an integer id back into a UUID, so — same as upgrade() — this is
    # a full rebuild, empty either direction.
    op.drop_table('votes')
    op.drop_table('comments')
    op.drop_table('candidate_set_stops')
    op.drop_table('availability_rules')
    op.drop_table('availability_overrides')
    op.drop_table('pins')
    op.drop_table('candidate_sets')
    op.drop_table('contributors')
    op.drop_table('blocks')
    op.drop_table('trips')

    op.create_table('trips',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('region_line', sa.String(length=300), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=True),
    sa.Column('end_date', sa.Date(), nullable=True),
    sa.Column('phase', postgresql.ENUM('ideation', 'scheduling', 'locked', name='tripphase', create_type=False), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('blocks',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('trip_id', sa.String(length=36), nullable=False),
    sa.Column('day_index', sa.Integer(), nullable=False),
    sa.Column('start_minute', sa.Integer(), nullable=False),
    sa.Column('end_minute', sa.Integer(), nullable=False),
    sa.Column('region', sa.String(length=120), nullable=False),
    sa.Column('status', postgresql.ENUM('empty', 'pencilled', 'placed', 'contested', 'locked', name='blockstatus', create_type=False), nullable=False),
    sa.Column('locked_set_id', sa.String(length=36), nullable=True),
    sa.ForeignKeyConstraint(['locked_set_id'], ['candidate_sets.id'], use_alter=True),
    sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('contributors',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('trip_id', sa.String(length=36), nullable=False),
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
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('block_id', sa.String(length=36), nullable=False),
    sa.Column('key', sa.String(length=8), nullable=False),
    sa.Column('label', sa.String(length=120), nullable=False),
    sa.Column('color', sa.String(length=32), nullable=False),
    sa.Column('is_draft', sa.Boolean(), nullable=False),
    sa.Column('created_by_id', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['block_id'], ['blocks.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['created_by_id'], ['contributors.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('pins',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('trip_id', sa.String(length=36), nullable=False),
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
    sa.Column('added_by_id', sa.String(length=36), nullable=True),
    sa.Column('added_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['added_by_id'], ['contributors.id'], ),
    sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('availability_overrides',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('pin_id', sa.String(length=36), nullable=False),
    sa.Column('day', sa.Integer(), nullable=False),
    sa.Column('band', sa.String(length=8), nullable=False),
    sa.Column('created_by_id', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by_id'], ['contributors.id'], ),
    sa.ForeignKeyConstraint(['pin_id'], ['pins.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('pin_id', 'day', 'band', name='uq_override_pin_day_band')
    )
    op.create_table('availability_rules',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('pin_id', sa.String(length=36), nullable=False),
    sa.Column('days', sa.JSON(), nullable=False),
    sa.Column('bands', sa.JSON(), nullable=False),
    sa.Column('reasons', sa.JSON(), nullable=False),
    sa.ForeignKeyConstraint(['pin_id'], ['pins.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('pin_id')
    )
    op.create_table('candidate_set_stops',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('candidate_set_id', sa.String(length=36), nullable=False),
    sa.Column('pin_id', sa.String(length=36), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['candidate_set_id'], ['candidate_sets.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['pin_id'], ['pins.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('candidate_set_id', 'pin_id', name='uq_set_stop_pin')
    )
    op.create_table('comments',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('pin_id', sa.String(length=36), nullable=True),
    sa.Column('candidate_set_id', sa.String(length=36), nullable=True),
    sa.Column('contributor_id', sa.String(length=36), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['candidate_set_id'], ['candidate_sets.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['contributor_id'], ['contributors.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['pin_id'], ['pins.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('votes',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('block_id', sa.String(length=36), nullable=False),
    sa.Column('candidate_set_id', sa.String(length=36), nullable=False),
    sa.Column('contributor_id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['block_id'], ['blocks.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['candidate_set_id'], ['candidate_sets.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['contributor_id'], ['contributors.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('block_id', 'contributor_id', name='uq_vote_block_contributor')
    )
