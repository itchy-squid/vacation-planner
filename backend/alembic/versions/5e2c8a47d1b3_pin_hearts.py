"""pin hearts: anyone who may vote can heart an idea on the board

Revision ID: 5e2c8a47d1b3
Revises: 3b6e9f0c2d14
Create Date: 2026-09-26 12:00:00.000000

One row per person per pin (app/models.py PinHeart). The count is how
popular an idea is, which the place and propose screens can sort by. A new
table and nothing else, so there is nothing to backfill, and the downgrade
just drops it (losing the hearts, which is what removing the feature means).

The unique constraint leads with pin_id, so it also serves "hearts on this
pin", the only lookup the app makes.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '5e2c8a47d1b3'
down_revision = '3b6e9f0c2d14'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'pin_hearts',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('pin_id', sa.Integer(), sa.ForeignKey('pins.id', ondelete='CASCADE'), nullable=False),
        sa.Column('contributor_id', sa.Integer(), sa.ForeignKey('contributors.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('pin_id', 'contributor_id', name='uq_pin_heart_pin_contributor'),
    )


def downgrade() -> None:
    op.drop_table('pin_hearts')
