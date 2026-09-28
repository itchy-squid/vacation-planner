"""pin google_place_id: the Google place a pin was added from

Revision ID: c81f3a9e4b27
Revises: 5e2c8a47d1b3
Create Date: 2026-09-28 12:00:00.000000

Pins can now be added by searching for a place, which brings its
coordinates (lat/lng, which already exist) and its Google place ID. The
place ID is kept because it's the one piece of Places data Google lets an
app store indefinitely: it spots the same place being added twice, and a
later refresh of the coordinates would use it. Nullable, with nothing to
backfill. The downgrade drops it.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c81f3a9e4b27'
down_revision = '5e2c8a47d1b3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('pins', sa.Column('google_place_id', sa.String(length=300), nullable=True))


def downgrade() -> None:
    op.drop_column('pins', 'google_place_id')
