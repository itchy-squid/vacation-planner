"""travel item from and to: where a leg leaves from and goes to

Revision ID: 2f6d8b4a9c17
Revises: 7e4b1c9a5d38
Create Date: 2026-10-06 23:30:00.000000

The day's Travel form can say where a leg starts and ends ("Houston IAH",
"Hotel Alma") whether or not either end is an idea, so a flight home or
a drive from the airport reads as one. Plain text, empty by default, so
nothing to backfill. `mode` also takes "flight" now, which needs no
schema change: it is a free string checked in schemas.py.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '2f6d8b4a9c17'
down_revision = '7e4b1c9a5d38'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('travel_items', sa.Column('from_label', sa.String(length=200), nullable=False, server_default=''))
    op.add_column('travel_items', sa.Column('to_label', sa.String(length=200), nullable=False, server_default=''))


def downgrade() -> None:
    with op.batch_alter_table('travel_items') as batch:
        batch.drop_column('to_label')
        batch.drop_column('from_label')
    # A flight has no mode before this revision.
    op.execute("UPDATE travel_items SET mode = NULL WHERE mode = 'flight'")
