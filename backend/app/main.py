from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import comments, contests, events, health, pins, plans, travel_items, trips

settings = get_settings()

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(trips.router)
app.include_router(pins.router)
app.include_router(plans.router)
app.include_router(contests.router)
app.include_router(travel_items.router)
app.include_router(comments.router)
app.include_router(events.router)
