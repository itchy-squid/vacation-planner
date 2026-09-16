"""trip sharing: member roles and invite links

Revision ID: e2a7c9d41f06
Revises: c4f1b8d20a37
Create Date: 2026-09-16 00:00:00.000000

`contributors.is_owner` becomes `contributors.role` (owner | contributor |
reader); app/permissions.py maps each role to the scopes it grants. Every
existing owner stays an owner and everyone else becomes a contributor, which
is exactly what they could do before, so no one loses access.

`trip_invites` holds the shareable join links, and
`contributors.joined_via_invite_id` records which link someone came in by.

Constraints and the new foreign key are added on Postgres only, the same
split the earlier revisions make: SQLite has no ALTER ... ADD CONSTRAINT and
is only backend-ci.yml's empty-database "does upgrade head run" check.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e2a7c9d41f06'
down_revision = 'c4f1b8d20a37'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == 'postgresql'

    op.create_table(
        'trip_invites',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('trip_id', sa.Integer(), sa.ForeignKey('trips.id', ondelete='CASCADE'), nullable=False),
        sa.Column('token', sa.String(length=64), nullable=False),
        sa.Column('role', sa.String(length=16), nullable=False),
        sa.Column('created_by_id', sa.Integer(), sa.ForeignKey('contributors.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('token', name='uq_trip_invites_token'),
        sa.CheckConstraint("role IN ('contributor', 'reader')", name='ck_trip_invite_role'),
    )
    op.create_index('ix_trip_invites_trip_id', 'trip_invites', ['trip_id'])

    op.add_column(
        'contributors',
        sa.Column('role', sa.String(length=16), nullable=False, server_default='contributor'),
    )
    op.execute("UPDATE contributors SET role = 'owner' WHERE is_owner")
    op.add_column('contributors', sa.Column('joined_via_invite_id', sa.Integer(), nullable=True))

    if is_postgres:
        # The default only existed to fill the rows above; app/models.py
        # sets role itself.
        op.alter_column('contributors', 'role', server_default=None)
        op.create_check_constraint(
            'ck_contributor_role', 'contributors', "role IN ('owner', 'contributor', 'reader')"
        )
        op.create_foreign_key(
            'fk_contributors_joined_via_invite_id',
            'contributors',
            'trip_invites',
            ['joined_via_invite_id'],
            ['id'],
            ondelete='SET NULL',
        )

    op.drop_column('contributors', 'is_owner')


def downgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == 'postgresql'

    # Readers come back as ordinary contributors: the old schema had no way
    # to say "read only", so this direction widens their access.
    op.add_column(
        'contributors',
        sa.Column('is_owner', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE contributors SET is_owner = (role = 'owner')")
    if is_postgres:
        op.alter_column('contributors', 'is_owner', server_default=None)
        op.drop_constraint('fk_contributors_joined_via_invite_id', 'contributors', type_='foreignkey')
        op.drop_constraint('ck_contributor_role', 'contributors', type_='check')
    op.drop_column('contributors', 'joined_via_invite_id')
    op.drop_column('contributors', 'role')

    op.drop_index('ix_trip_invites_trip_id', table_name='trip_invites')
    op.drop_table('trip_invites')
