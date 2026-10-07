"""trip expenses: costs that aren't places (tickets, passes, rentals)

Revision ID: b4e7d1a9c362
Revises: a7d4c2e9f813
Create Date: 2026-10-07 12:00:00.000000

A pin can now be an "expense" (pins.kind is a plain string, so that needs
no change here): a park ticket or a rental car, kept in Expenses rather
than on the Ideas board. It says what it is (`expense_type`), who it's for
(`traveler_ids`, null meaning everyone) and, for a pass, which ideas it
gets its holders into (`covers_pin_ids`). All nullable, nothing to
backfill: no existing pin is an expense. The downgrade drops all three.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b4e7d1a9c362'
down_revision = 'a7d4c2e9f813'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('pins', sa.Column('expense_type', sa.String(length=8), nullable=True))
    op.add_column('pins', sa.Column('traveler_ids', sa.JSON(), nullable=True))
    op.add_column('pins', sa.Column('covers_pin_ids', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('pins', 'covers_pin_ids')
    op.drop_column('pins', 'traveler_ids')
    op.drop_column('pins', 'expense_type')
