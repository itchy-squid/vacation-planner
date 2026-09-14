"""collapse travel item kinds into one travel kind

Revision ID: c4f1b8d20a37
Revises: 9c1e40b7a2d5
Create Date: 2026-09-14 00:00:00.000000

flight/train/drive — and the "ferry" the day form offered but
app/schemas.py's Literal never accepted — become one "travel" kind. See
that Literal's comment for why the split went; "lodging" and "other" are
untouched.

`travel_items.kind` is a plain VARCHAR(20) on every dialect (app/models.py
keeps it a free string rather than a DB enum precisely so the suggested
set can move without a type migration), so this is data only — no column
type to alter, and nothing dialect-specific to guard.

The downgrade cannot put back what the rows used to say: once three kinds
are one, which of them a given row started as is gone. It maps everything
back to "other" rather than guessing "flight", which would invent a fact
about someone's trip. Anything already "other" is left alone by both
directions, so a round trip is lossy but never wrong.
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = 'c4f1b8d20a37'
down_revision = '9c1e40b7a2d5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 'ferry' was never a legal value server-side: the day form's <option>
    # offered it and TravelItemCreate rejected it with a 422, so no row
    # should carry one. It costs nothing to sweep, and a database seeded
    # by hand or by an older fixture may well have one.
    op.execute(
        "UPDATE travel_items SET kind = 'travel'"
        " WHERE kind IN ('flight', 'train', 'drive', 'ferry')"
    )


def downgrade() -> None:
    op.execute("UPDATE travel_items SET kind = 'other' WHERE kind = 'travel'")
