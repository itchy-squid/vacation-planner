"""planner and companion roles

Revision ID: b7d3e5a10c42
Revises: e2a7c9d41f06
Create Date: 2026-09-16 12:00:00.000000

The "contributor" role is renamed "planner", and a new "companion" role sits
between reader and planner (see app/permissions.py). Every existing
contributor, and every live contributor invite link, becomes a planner, so
no one's access changes.

Only the role value is renamed. The member table is still `contributors`
and the model is still `Contributor` — that name means "someone on the
trip", whatever their role.

Postgres swaps both check constraints in place. SQLite (backend-ci.yml's
empty-database check) can't alter a constraint, so trip_invites — whose
check came in with its CREATE TABLE — is rebuilt in batch mode;
contributors never got a check there.
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'b7d3e5a10c42'
down_revision = 'e2a7c9d41f06'
branch_labels = None
depends_on = None

_OLD_MEMBER = "role IN ('owner', 'contributor', 'reader')"
_NEW_MEMBER = "role IN ('owner', 'planner', 'companion', 'reader')"
_OLD_INVITE = "role IN ('contributor', 'reader')"
_NEW_INVITE = "role IN ('planner', 'companion', 'reader')"
_EITHER_INVITE = "role IN ('contributor', 'planner', 'companion', 'reader')"


def _rebuild_invite_check(check: str) -> None:
    with op.batch_alter_table('trip_invites', recreate='always') as batch:
        batch.drop_constraint('ck_trip_invite_role', type_='check')
        batch.create_check_constraint('ck_trip_invite_role', check)


def _swap_checks(member_check: str, invite_check: str, member_update: str, invite_update: str) -> None:
    """Rename role values under new check constraints. The rows can only
    change while neither the old nor the new check is in the way."""
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.drop_constraint('ck_contributor_role', 'contributors', type_='check')
        op.drop_constraint('ck_trip_invite_role', 'trip_invites', type_='check')
        op.execute(member_update)
        op.execute(invite_update)
        op.create_check_constraint('ck_contributor_role', 'contributors', member_check)
        op.create_check_constraint('ck_trip_invite_role', 'trip_invites', invite_check)
    else:
        # contributors has no check on SQLite. trip_invites does, and a
        # batch rebuild copies the rows into a table that already has the
        # new one, so they have to pass both on the way through: widen,
        # rename, then narrow.
        op.execute(member_update)
        _rebuild_invite_check(_EITHER_INVITE)
        op.execute(invite_update)
        _rebuild_invite_check(invite_check)


def upgrade() -> None:
    _swap_checks(
        _NEW_MEMBER,
        _NEW_INVITE,
        "UPDATE contributors SET role = 'planner' WHERE role = 'contributor'",
        "UPDATE trip_invites SET role = 'planner' WHERE role = 'contributor'",
    )


def downgrade() -> None:
    # There was no companion before: companions come back as contributors,
    # which widens their access, the same trade the sharing migration's
    # downgrade makes for readers. Their invite links are revoked rather
    # than silently turned into contributor links (a revoked link's role
    # still has to pass the old check, so it's stored as contributor).
    op.execute(
        "UPDATE trip_invites SET revoked_at = CURRENT_TIMESTAMP "
        "WHERE role = 'companion' AND revoked_at IS NULL"
    )
    _swap_checks(
        _OLD_MEMBER,
        _OLD_INVITE,
        "UPDATE contributors SET role = 'contributor' WHERE role IN ('planner', 'companion')",
        "UPDATE trip_invites SET role = 'contributor' WHERE role IN ('planner', 'companion')",
    )
