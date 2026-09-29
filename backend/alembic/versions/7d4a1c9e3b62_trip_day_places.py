"""trip day places: where the group is on each day of the trip

Revision ID: 7d4a1c9e3b62
Revises: e6b2d9f41a73
Create Date: 2026-09-29 12:00:00.000000

"Where we'll be": each date of a trip gets at most one place it's staying
in and any number of day trips (app/models.py TripDayPlace). A new table
and nothing else; people fill it in, so there's nothing to backfill. The
downgrade drops it.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7d4a1c9e3b62'
down_revision = 'e6b2d9f41a73'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'trip_day_places',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('trip_id', sa.Integer(), sa.ForeignKey('trips.id', ondelete='CASCADE'), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('name_key', sa.String(length=120), nullable=False),
        sa.Column('kind', sa.String(length=8), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.UniqueConstraint('trip_id', 'date', 'position', name='uq_trip_day_place_position'),
        sa.UniqueConstraint('trip_id', 'date', 'name_key', name='uq_trip_day_place_name'),
        sa.CheckConstraint("kind IN ('stay', 'visit')", name='ck_trip_day_place_kind'),
        sa.CheckConstraint("(kind = 'stay') = (position = 0)", name='ck_trip_day_place_stay_first'),
    )
    op.create_index('ix_trip_day_places_trip_id', 'trip_day_places', ['trip_id'])


def downgrade() -> None:
    op.drop_index('ix_trip_day_places_trip_id', table_name='trip_day_places')
    op.drop_table('trip_day_places')
