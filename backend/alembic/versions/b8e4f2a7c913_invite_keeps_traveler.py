"""trip_invites.keeps_traveler: direct invites that swap someone in

Revision ID: b8e4f2a7c913
Revises: 4d7a2e9c6b15
Create Date: 2026-10-05 14:00:00.000000

An existing trip can invite people the owner has planned with before, and
each invite can take over a traveler who's already listed ("Jonah",
"Traveler 5") instead of adding one. Declining such an invite leaves that
traveler on the roster, so the invite records which kind it is. Every
existing row is false: until now a direct invite's traveler was always
listed for it.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b8e4f2a7c913'
down_revision = '4d7a2e9c6b15'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('trip_invites', sa.Column('keeps_traveler', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table('trip_invites') as batch:
        batch.drop_column('keeps_traveler')
