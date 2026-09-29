"""trip rides and lodging: how a ride goes, and where each night is spent

Revision ID: 4c8e2b9d7f15
Revises: 9b3e5f7a2c14
Create Date: 2026-09-29 18:00:00.000000

Trips planned from the Map tab put rides on the calendar as travel items,
so a travel item can now say how it goes (`mode`: car, bus, train or walk)
and how far (`distance_meters`). And a day's stay can name the idea the
group is staying at (`trip_day_places.pin_id`), which is where those trips
start and end. All nullable, nothing to backfill: existing travel items
were typed in by hand and existing stays name only a town. The downgrade
drops all three.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '4c8e2b9d7f15'
down_revision = '9b3e5f7a2c14'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('travel_items', sa.Column('mode', sa.String(length=8), nullable=True))
    op.add_column('travel_items', sa.Column('distance_meters', sa.Integer(), nullable=True))
    # batch_alter_table so the foreign key and check can be added on SQLite
    # (a local dev database) as well as Postgres.
    with op.batch_alter_table('trip_day_places') as batch:
        batch.add_column(sa.Column('pin_id', sa.Integer(), nullable=True))
        batch.create_foreign_key(
            'fk_trip_day_places_pin_id', 'pins', ['pin_id'], ['id'], ondelete='SET NULL'
        )
        batch.create_check_constraint('ck_trip_day_place_lodging_on_stay', "pin_id IS NULL OR kind = 'stay'")


def downgrade() -> None:
    with op.batch_alter_table('trip_day_places') as batch:
        batch.drop_constraint('ck_trip_day_place_lodging_on_stay', type_='check')
        batch.drop_constraint('fk_trip_day_places_pin_id', type_='foreignkey')
        batch.drop_column('pin_id')
    op.drop_column('travel_items', 'distance_meters')
    op.drop_column('travel_items', 'mode')
