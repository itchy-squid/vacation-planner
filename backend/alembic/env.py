from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool, text

from app.config import get_settings
from app.db import Base, install_azure_ad_token_provider
from app import models  # noqa: F401 — registers all models on Base.metadata

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.database_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool)

    # Same passwordless-connection support as app/db.py, so `alembic
    # upgrade` can be run directly against the production Azure Postgres
    # server (by a maintainer's own `az login` session, or in CI) without
    # ever needing a stored database password — see infra/README.md
    # "Managed identity database auth".
    if settings.use_azure_ad_auth:
        install_azure_ad_token_provider(connectable, settings)

    with connectable.connect() as connection:
        # Every object this migration creates should be owned by the
        # db_owner group role, never by whichever individual maintainer's
        # login happens to run the migration — that's what lets ownership
        # never need to change as maintainers come and go (see
        # infra/sql/provision_roles.sql and infra/README.md "Adding a
        # maintainer"). Guarded by role existence so this is a no-op for
        # local dev (docker-compose's plain `planner` user, no db_owner
        # role) and for the SQLite sanity check in backend-ci.yml.
        if connection.dialect.name == "postgresql":
            owner_role_exists = connection.execute(
                text("SELECT 1 FROM pg_roles WHERE rolname = 'db_owner'")
            ).scalar()
            if owner_role_exists:
                connection.execute(text("SET ROLE db_owner"))

        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
        # Belt-and-suspenders: some SQLAlchemy/psycopg3/Alembic version
        # combinations have been observed to leave this transaction
        # uncommitted when the connection object is simply closed rather
        # than explicitly committed (verified against a real Postgres 16
        # server while building this migration — omitting this line left
        # every table silently un-created despite Alembic logging success).
        connection.commit()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
