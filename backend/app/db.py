from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import Settings, get_settings

settings = get_settings()

# Azure Database for PostgreSQL Flexible Server's AAD-auth resource/scope —
# see infra/README.md "Managed identity database auth". Fixed by Azure, not
# configurable.
_AZURE_POSTGRES_AAD_SCOPE = "https://ossrdbms-aad.database.windows.net/.default"


def install_azure_ad_token_provider(engine: Engine, settings: Settings) -> None:
    """Passwordless auth to Azure Database for PostgreSQL Flexible Server:
    attach a `do_connect` listener that supplies a fresh Microsoft Entra ID
    access token as the connection password on every new physical
    connection, instead of a stored password (per the project's "any auth
    to the database should use managed identities" requirement).

    `DefaultAzureCredential` picks up the Container App's user-assigned
    managed identity in production (via `settings.azure_client_id`, which
    the app reads from the AZURE_CLIENT_ID env var the infra sets — see
    infra/modules/container-app-backend.bicep), or a developer's own `az
    login` session / Azure CLI credential when this is run locally against
    a real Azure Postgres server (e.g. to run migrations by hand).

    Tokens are short-lived (Microsoft's guidance: assume ~1 hour for a
    user/service-principal token), so this must fetch a new one per
    connection rather than once at import time — see the pool_recycle set
    alongside this in the engine below, which forces the pool to periodically
    reconnect (and thus refresh the token) rather than holding one
    connection open indefinitely."""
    from azure.identity import DefaultAzureCredential

    credential = (
        DefaultAzureCredential(managed_identity_client_id=settings.azure_client_id)
        if settings.azure_client_id
        else DefaultAzureCredential()
    )

    @event.listens_for(engine, "do_connect")
    def _provide_azure_ad_token(dialect, conn_rec, cargs, cparams):
        cparams["password"] = credential.get_token(_AZURE_POSTGRES_AAD_SCOPE).token


engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    # Recycle connections well under the ~1hr token lifetime so a held
    # connection can't outlive its token; irrelevant (and left at the
    # SQLAlchemy default of no recycling) when not using AAD auth.
    pool_recycle=1800 if settings.use_azure_ad_auth else -1,
    future=True,
)
if settings.use_azure_ad_auth:
    install_azure_ad_token_provider(engine, settings)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
