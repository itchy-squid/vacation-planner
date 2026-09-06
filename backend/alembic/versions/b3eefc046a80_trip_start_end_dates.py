"""trip start/end dates, drop date_line

Revision ID: b3eefc046a80
Revises: c20d0f371d3d
Create Date: 2026-09-06 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b3eefc046a80'
down_revision = 'c20d0f371d3d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('trips', sa.Column('start_date', sa.Date(), nullable=True))
    op.add_column('trips', sa.Column('end_date', sa.Date(), nullable=True))
    op.drop_column('trips', 'date_line')


def downgrade() -> None:
    op.add_column('trips', sa.Column('date_line', sa.String(length=100), nullable=False, server_default=''))
    op.drop_column('trips', 'end_date')
    op.drop_column('trips', 'start_date')
