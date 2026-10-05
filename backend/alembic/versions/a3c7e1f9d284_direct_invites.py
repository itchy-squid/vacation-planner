"""trip_invites.invitee_email/invitee_name: invites sent to one person

Revision ID: a3c7e1f9d284
Revises: 8f2d6a3c1e59
Create Date: 2026-10-05 12:00:00.000000

A new trip can invite people the owner has planned with before
(routers/people.py). Each such invite is a trip_invites row addressed to
one email, which only that person can accept or decline. Both columns are
nullable and null on every existing row (those are links). The downgrade
drops them, and with them any direct invite still waiting.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a3c7e1f9d284'
down_revision = '8f2d6a3c1e59'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('trip_invites', sa.Column('invitee_email', sa.String(length=320), nullable=True))
    op.add_column('trip_invites', sa.Column('invitee_name', sa.String(length=120), nullable=True))
    op.create_index('ix_trip_invites_invitee_email', 'trip_invites', ['invitee_email'])


def downgrade() -> None:
    op.execute("DELETE FROM trip_invites WHERE invitee_email IS NOT NULL")
    op.drop_index('ix_trip_invites_invitee_email', table_name='trip_invites')
    op.drop_column('trip_invites', 'invitee_name')
    op.drop_column('trip_invites', 'invitee_email')
