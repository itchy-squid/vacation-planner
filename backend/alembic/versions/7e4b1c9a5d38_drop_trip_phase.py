"""drop trips.phase: nothing reads it any more

Revision ID: 7e4b1c9a5d38
Revises: 5a9c3e7b1d20
Create Date: 2026-10-05 12:00:00.000000

A trip's phase (ideation / scheduling / locked) was set once, at creation,
and never moved: nothing in the app changed it, so every badge and progress
bar it drove said the same thing forever. The column and its enum go.

The downgrade brings the column back with every trip at "ideation", which
is what new trips always got.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7e4b1c9a5d38'
down_revision = '5a9c3e7b1d20'
branch_labels = None
depends_on = None


_PHASE = sa.Enum('ideation', 'scheduling', 'locked', name='tripphase')


def upgrade() -> None:
    with op.batch_alter_table('trips') as batch:
        batch.drop_column('phase')
    _PHASE.drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    _PHASE.create(op.get_bind(), checkfirst=True)
    op.add_column('trips', sa.Column('phase', _PHASE, nullable=False, server_default='ideation'))
    if op.get_bind().dialect.name == 'postgresql':
        op.alter_column('trips', 'phase', server_default=None)
