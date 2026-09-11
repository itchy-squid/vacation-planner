# Production image for the FastAPI backend, served by uvicorn on an Azure
# Container App (see infra/modules/containerapp.bicep). Uses uv for fast,
# reproducible installs from uv.lock.

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first (cached separately from app code changes).
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini .

ENV PATH="/app/.venv/bin:$PATH"

# Azure Container Apps sets $PORT; default to 8000 for local/docker-compose use.
ENV PORT=8000
EXPOSE 8000

# Migrations run in CI (.github/workflows/deploy.yml's "migrate" job,
# using the "gh-deploy" Postgres role), not here -- the app's own identity
# (app-backend) only ever has db_rw, so it has no DDL privileges to run
# `alembic upgrade head` itself. See claude/db-privilege-provisioning.md.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
