"""split-party plans

Revision ID: f3a8d2c61b90
Revises: b7d3e5a10c42
Create Date: 2026-09-23 12:00:00.000000

Plans and contests gain a `party`: the contributor ids the plan is for,
with [] meaning everyone on the trip (the same convention as pins.heads).
Two plans may share hours when their parties don't share a person, which
is how the group splitting up for a day is modelled; see app/party.py.

No backfill. Every existing plan and contest is for everyone, and [] is
exactly that, so the server_default fills every row with what it already
meant. The default is dropped again on Postgres afterwards so the schema
matches app/models.py, the same way the proposals revision handled heads.

The downgrade has to put the calendar back into a shape the old overlap
rule accepts: without parties, two plans at the same time always collide.
So it deletes every plan that isn't for everyone and keeps the ones that
are. That loses the split branches, which is what removing the feature
means; nothing is invented about anyone's day.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f3a8d2c61b90'
down_revision = 'b7d3e5a10c42'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == 'postgresql'

    op.add_column('plans', sa.Column('party', sa.JSON(), nullable=False, server_default='[]'))
    op.add_column('contests', sa.Column('party', sa.JSON(), nullable=False, server_default='[]'))

    if is_postgres:
        op.alter_column('plans', 'party', server_default=None)
        op.alter_column('contests', 'party', server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == 'postgresql'

    # JSON has no equality operator on Postgres, so compare its text form.
    # Contests go first: deleting one cascades to its options and votes.
    if is_postgres:
        op.execute("DELETE FROM contests WHERE party::text <> '[]'")
        op.execute("DELETE FROM plans WHERE party::text <> '[]'")
    else:
        op.execute("DELETE FROM contests WHERE party <> '[]'")
        op.execute("DELETE FROM plans WHERE party <> '[]'")

    op.drop_column('contests', 'party')
    op.drop_column('plans', 'party')
