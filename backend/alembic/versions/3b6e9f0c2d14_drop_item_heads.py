"""drop per-item cost splits: a cost is shared by whoever is on the plan

Revision ID: 3b6e9f0c2d14
Revises: d52b8e1f7a93
Create Date: 2026-09-27 12:00:00.000000

`pins.heads` and `travel_items.heads` let an idea name the travelers who
share its cost, overriding who the plan it's scheduled in is for. That was
wrong in practice: an idea marked "Mei" and then placed on a plan for
everyone charged Mei alone while the calendar said everyone was going. The
people sharing a cost are now always the plan's travelers (everyone, or its
group on a split day — app/derive.py item_money), and who pays each share
is the traveler payer rule (Traveler.paid_by_id).

The downgrade brings the columns back empty, which is the old "whoever is
on the plan" default, so totals don't move either way.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '3b6e9f0c2d14'
down_revision = 'd52b8e1f7a93'
branch_labels = None
depends_on = None


_TABLES = ('pins', 'travel_items')


def upgrade() -> None:
    for table in _TABLES:
        with op.batch_alter_table(table) as batch:
            batch.drop_column('heads')


def downgrade() -> None:
    for table in _TABLES:
        op.add_column(table, sa.Column('heads', sa.JSON(), nullable=False, server_default='[]'))
    # As in 9c1e40b7a2d5: the default exists only to fill existing rows.
    if op.get_bind().dialect.name == 'postgresql':
        for table in _TABLES:
            op.alter_column(table, 'heads', server_default=None)
