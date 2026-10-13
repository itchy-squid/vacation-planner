"""day comments: a comment on a whole day of the trip

Revision ID: c6a9e2f47b18
Revises: b4e7d1a9c362
Create Date: 2026-10-13 12:00:00.000000

A comment can now be on a day of the trip instead of an idea or a plan:
`trip_id` says which trip and `day` which day (1 is the first, like
trip_day_places). The two are set together or not at all. `edited_at` is
when its author last changed it. All nullable, nothing to backfill: every
existing comment is on an idea or a plan and has never been edited.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c6a9e2f47b18'
down_revision = 'b4e7d1a9c362'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('comments') as batch:
        batch.add_column(sa.Column('trip_id', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('day', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('edited_at', sa.DateTime(timezone=True), nullable=True))
        batch.create_foreign_key('fk_comments_trip_id_trips', 'trips', ['trip_id'], ['id'], ondelete='CASCADE')
        batch.create_index('ix_comments_trip_id', ['trip_id'])
        batch.create_check_constraint('ck_comment_day_on_trip', '(day IS NULL) = (trip_id IS NULL)')


def downgrade() -> None:
    op.execute("DELETE FROM comments WHERE trip_id IS NOT NULL")
    with op.batch_alter_table('comments') as batch:
        batch.drop_constraint('ck_comment_day_on_trip', type_='check')
        batch.drop_index('ix_comments_trip_id')
        batch.drop_constraint('fk_comments_trip_id_trips', type_='foreignkey')
        batch.drop_column('edited_at')
        batch.drop_column('day')
        batch.drop_column('trip_id')
