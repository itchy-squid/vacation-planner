from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, sourced from environment variables (or a local
    .env file — see .env.example at the repo root). In Azure, these are set
    as Container App environment variables / secrets (see infra/)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"

    # postgresql+psycopg://user:pass@host:5432/dbname (Azure Postgres Flexible
    # Server needs sslmode=require in the URL — see .env.example).
    database_url: str = "postgresql+psycopg://planner:planner@localhost:5432/vacation_planner"

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
