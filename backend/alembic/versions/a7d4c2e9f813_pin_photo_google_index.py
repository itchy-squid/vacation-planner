"""pin photo_google_index: a pin's photo can be one of its Google place's

Revision ID: a7d4c2e9f813
Revises: 2f6d8b4a9c17
Create Date: 2026-10-07 12:00:00.000000

Google's terms don't allow copying a place's photos, or keeping their
names, so a pin that uses one stores only which of its place's photos it
is (its position in what Google returns for google_place_id); the browser
looks the image up each time it's shown. Nullable, nothing to backfill.
The downgrade drops it.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a7d4c2e9f813'
down_revision = '2f6d8b4a9c17'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('pins', sa.Column('photo_google_index', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('pins', 'photo_google_index')
