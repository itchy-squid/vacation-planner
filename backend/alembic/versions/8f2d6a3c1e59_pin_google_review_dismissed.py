"""pin google_review_dismissed: left out of the "On Google Maps?" review

Revision ID: 8f2d6a3c1e59
Revises: 4c8e2b9d7f15
Create Date: 2026-10-03 12:00:00.000000

The Map tab's "On Google Maps?" review (frontend pages/LinkReview.jsx)
looks up ideas that have no exact spot. Once someone answers "None of
these" for an idea, it shouldn't be offered again, so the pin remembers
that. Not null, false for every existing pin. The downgrade drops it.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '8f2d6a3c1e59'
down_revision = '4c8e2b9d7f15'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('pins', sa.Column('google_review_dismissed', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column('pins', 'google_review_dismissed')
