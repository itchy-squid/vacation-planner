"""trip regions: where each of a trip's regions is on the map

Revision ID: e6b2d9f41a73
Revises: c81f3a9e4b27
Create Date: 2026-09-28 18:00:00.000000

A pin with no exact spot is shown in its region on the Map tab, so each
region name a trip uses gets a stored centre and area (app/models.py
TripRegion), looked up once by the frontend. A new table and nothing else;
the frontend fills it in as regions are used, so there's nothing to
backfill. The downgrade drops it.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e6b2d9f41a73'
down_revision = 'c81f3a9e4b27'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'trip_regions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('trip_id', sa.Integer(), sa.ForeignKey('trips.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('name_key', sa.String(length=120), nullable=False),
        sa.Column('lat', sa.Float(), nullable=False),
        sa.Column('lng', sa.Float(), nullable=False),
        sa.Column('south', sa.Float(), nullable=False),
        sa.Column('west', sa.Float(), nullable=False),
        sa.Column('north', sa.Float(), nullable=False),
        sa.Column('east', sa.Float(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('trip_id', 'name_key', name='uq_trip_region_name'),
    )
    op.create_index('ix_trip_regions_trip_id', 'trip_regions', ['trip_id'])


def downgrade() -> None:
    op.drop_index('ix_trip_regions_trip_id', table_name='trip_regions')
    op.drop_table('trip_regions')
