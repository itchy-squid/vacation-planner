"""pin kind and per-day costs: stays, and prices paid by the day

Revision ID: 4d7a2e9c6b15
Revises: a3c7e1f9d284
Create Date: 2026-10-05 12:00:00.000000

An idea can now be a stay (somewhere to sleep) rather than something to
do, and a price can be paid by the day rather than once. Every existing
idea is an activity paid once, which is what the server defaults fill in,
so nothing's total moves. The days a per-day price covers are a pair of
nullable dates with nothing to backfill. The downgrade drops all four.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '4d7a2e9c6b15'
down_revision = 'a3c7e1f9d284'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('pins', sa.Column('kind', sa.String(length=16), nullable=False, server_default='activity'))
    op.add_column('pins', sa.Column('cost_per', sa.String(length=8), nullable=False, server_default='once'))
    op.add_column('pins', sa.Column('cost_start_date', sa.Date(), nullable=True))
    op.add_column('pins', sa.Column('cost_end_date', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('pins', 'cost_end_date')
    op.drop_column('pins', 'cost_start_date')
    op.drop_column('pins', 'cost_per')
    op.drop_column('pins', 'kind')
