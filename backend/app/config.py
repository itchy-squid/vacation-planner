from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, sourced from environment variables (or a local
    .env file — see .env.example at the repo root). In Azure, these are set
    as Container App environment variables / secrets (see infra/)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"

    # postgresql+psycopg://user:pass@host:5432/dbname for local dev (matches
    # docker-compose.yml). In production this has no password in the URL at
    # all — see use_azure_ad_auth below — and needs sslmode=require; e.g.
    # postgresql+psycopg://app-backend@pg-vacplanner-prod.postgres.database.azure.com:5432/vacation_planner?sslmode=require
    database_url: str = "postgresql+psycopg://planner:planner@localhost:5432/vacation_planner"

    # When true, the password half of every new database connection is
    # replaced with a freshly fetched Microsoft Entra ID access token (see
    # app/db.py install_azure_ad_token_provider) instead of whatever's in
    # database_url — the "any auth to the database should use managed
    # identities" requirement. Set via the Container App's environment in
    # production (see infra/modules/container-app-backend.bicep); left
    # false for local dev against the docker-compose Postgres, which still
    # uses a plain password.
    use_azure_ad_auth: bool = False

    # The Container App's user-assigned managed identity client ID (see
    # infra/modules/managed-identity.bicep), so DefaultAzureCredential picks
    # that identity specifically rather than guessing among several. Left
    # unset for a developer running against Azure with their own `az login`
    # session (DefaultAzureCredential falls back to the Azure CLI credential).
    azure_client_id: str | None = None

    # Comma-separated list of allowed browser origins for CORS.
    cors_origins: str = "http://localhost:5173"

    # Azure Container Apps / App Service built-in auth ("Easy Auth") forwards
    # signed-in Entra ID users via X-MS-CLIENT-PRINCIPAL* headers — see
    # app/auth.py. Locally, with no Easy Auth in front of you, requests are
    # attributed to this fake user instead of being rejected.
    dev_user_email: str = "mei@example.com"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_development(self) -> bool:
        return self.environment.lower() in {"development", "dev", "local"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
