from fastapi import FastAPI

from .routers import (
    account,
    comments,
    contests,
    events,
    health,
    me,
    pins,
    plans,
    sharing,
    spa_redirect,
    splits,
    travel_items,
    travelers,
    trips,
)

app = FastAPI(
    title="Vacation Planner API",
    description=(
        "Backend for the collaborative vacation planner. Runs on uvicorn, "
        "deployed to an Azure Container App, backed by Azure Database for "
        "PostgreSQL Flexible Server. Identity comes from Azure Easy Auth "
        "(Entra ID) in production — see app/auth.py."
    ),
    version="0.1.0",
)

# CORS is enforced entirely at the Azure Container Apps ingress layer
# (see infra/modules/container-app-backend.bicep's corsPolicy) -- not
# here, so there is exactly one place it's configured. Local dev
# sidesteps the need for it altogether via the Vite dev server's proxy
# (frontend/vite.config.js), which makes every request same-origin.

app.include_router(health.router)
app.include_router(me.router)
app.include_router(account.router)
app.include_router(trips.router)
app.include_router(pins.router)
app.include_router(plans.router)
app.include_router(contests.router)
app.include_router(splits.router)
app.include_router(travel_items.router)
app.include_router(comments.router)
app.include_router(sharing.router)
app.include_router(travelers.router)
app.include_router(events.router)

# Must stay last: it's a catch-all for every GET path the routers above
# (and FastAPI's own /docs, /redoc, /openapi.json) didn't claim.
app.include_router(spa_redirect.router)
