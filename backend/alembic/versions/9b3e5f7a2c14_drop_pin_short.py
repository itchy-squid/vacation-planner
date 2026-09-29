"""drop pins.short: the pin's title is its only name

Revision ID: 9b3e5f7a2c14
Revises: 7d4a1c9e3b62
Create Date: 2026-09-29 18:00:00.000000

`short` was a truncated copy of the title, taken once when a pin was
created. Renaming a pin never updated it, so screens that read it (the
propose screen's "Pull in" chips, the calendar's places, the placing
banner) showed the pin's first name, often the host of a pasted link.
The frontend now reads `title` everywhere and truncates where space is
tight, so the column goes.

The downgrade puts the column back, filled from the title the same way
the create forms used to fill it (27 characters plus an ellipsis past 28).
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '9b3e5f7a2c14'
down_revision = '7d4a1c9e3b62'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column('pins', 'short')


def downgrade() -> None:
    op.add_column('pins', sa.Column('short', sa.String(length=60), nullable=True))
    op.execute(
        "UPDATE pins SET short = CASE WHEN char_length(title) > 28 "
        "THEN left(title, 27) || '\u2026' ELSE title END"
    )
    op.alter_column('pins', 'short', existing_type=sa.String(length=60), nullable=False)
