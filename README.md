# Vacation Planner

A collaborative vacation planner for mobile web. A group collects places
they want to go as pins on a Pinterest-style board; the trip then moves into
scheduling, where pins are dragged onto free-length blocks on a day
timeline, and contested blocks are resolved by comparing candidate *sets* of
places on a shared map, with per-set votes, comments, and an owner lock.

Design source: the handoff in `.claude/claude-design.zip` (design system
tokens + two `.dc.html` prototypes) — see that bundle's own README for the
full screen-by-screen spec.

## Stack

- **Frontend**: React + Vite, plain CSS custom properties (matches the
  design tokens). `frontend/`
- **Backend**: FastAPI/uvicorn, SQLAlchemy 2.0 + Alembic, deployed as an
  Azure Container App. `backend/`
- **Database**: Azure Database for PostgreSQL Flexible Server.
- **Auth**: Container Apps Easy Auth with Microsoft Entra ID — not turned
  on yet, but the backend trusts it already (`backend/app/auth.py`).
- **Infra**: Bicep (`infra/`), deployed via GitHub Actions (`.github/workflows/`).

## Current state — read this before assuming something works

1. **Frontend**: the 7 design-handoff screens are implemented, plus a few
   added since (see "Added beyond the design handoff"). Trips,
   contributors, pins, votes, locks, and comments persist to the real API
   (`frontend/src/state/PlannerContext.jsx`, `frontend/src/lib/api.js`).
   `frontend/src/data/*.js` is no longer live: `pins.js`/`contributors.js`
   are dead code kept as a record of the original sample content; `trip.js`
   (day-of-week labels) and `schedule.js` (decorative non-contested-block
   content) are still local-only by design — nothing to persist them to yet.
2. **Backend**: full Postgres schema, Easy-Auth-aware identity, Alembic
   migrations, and REST endpoints for everything the frontend uses. Unused:
   `GET /api/trips/{id}/events` (SSE, `backend/app/routers/events.py`)
   exists but nothing opens an `EventSource` yet — another contributor's
   changes need a manual reload. See "Next steps".
3. **Infra**: Bicep templates are written and validated but **nothing has
   been deployed to a real Azure subscription**. See `infra/README.md` for
   the one-time manual setup a deploy needs first.

Not designed at all, per the handoff: drag-and-drop from the tray onto the
timeline (only drop targets are drawn), a real comment-thread view
(comments are counts + one quoted line today), the photo-picker flow, and
invite/permissions/login screens.

### Added beyond the design handoff

Engineering additions, not design-reviewed screens:

- **Creating a trip** (`frontend/src/pages/NewTrip.jsx`,
  `POST /api/trips`) — the creator becomes its owner-contributor.
- **Switching the active trip** from Trips Home's "Also planning" rail
  (`PlannerContext`'s `OPEN_TRIP` action). No way yet to edit a trip you
  haven't switched to first.
- **Adding a pin from a link** (`frontend/src/pages/NewPin.jsx`,
  `POST /api/trips/{id}/pins`) — hands off to Edit Visit for
  duration/cost/notes/tags. Board region filter chips derive from the
  active trip's real pins now.
- **Trip settings** (`frontend/src/pages/TripSettings.jsx`,
  `PATCH /api/trips/{id}`) — name, regions, start/end dates, reachable
  from the Board/Map/Schedule header (`components/core/SettingsButton.jsx`).
  Dates are real `start_date`/`end_date` columns (`b3eefc046a80` migration);
  day-of-trip scheduling intentionally doesn't derive from them yet — see
  `formatDateRange` in `frontend/src/lib/format.js`.

## Repo layout

```
frontend/          React + Vite app (frontend/src/pages)
backend/           FastAPI app, Alembic migrations, Dockerfile
infra/             Bicep templates + infra/README.md (manual setup steps)
.github/workflows/ CI (lint/build) + deploy (build image, apply Bicep, deploy frontend)
docker-compose.yml Local Postgres only
.env.example       Copy to .env for local dev
```

## Local development

**Frontend**
```
cd frontend
npm install
npm run dev        # http://localhost:5173
```
`frontend/src/dev/DevNav.jsx` is a bottom strip for jumping between the 7
screens — not part of the design, just review scaffolding. Delete once real
trip-level navigation exists.

**Backend — requires Docker Desktop running** (for local Postgres; or point
`DATABASE_URL` at a Postgres instance you already have)

Uses [uv](https://docs.astral.sh/uv/) rather than raw pip/venv.

```
docker compose up -d db                 # local Postgres on :5432
cd backend
uv sync --group dev
cp ../.env.example ../.env
uv run alembic upgrade head
uv run uvicorn app.main:app --reload    # http://localhost:8000/docs
```

With no Easy Auth locally, the backend attributes requests to
`DEV_USER_EMAIL` (see `.env.example`).

## Deployment

See `infra/README.md` for one-time setup (resource group, Entra app
registration, GitHub secrets). Once done, pushing to `main` runs
`.github/workflows/deploy.yml`.

**Assumption flagged for confirmation**: frontend deploys to **Azure
Static Web Apps** — unspecified, chosen to pair with a Container App
backend + GitHub Actions. To change it: `.github/workflows/deploy.yml`'s
`frontend` job and `infra/modules/static-web-app.bicep`.

## Next steps

1. **Live updates via SSE** — subscribe to `GET /api/trips/{id}/events`
   in `PlannerContext.jsx`.
2. **Turn on Easy Auth** — `infra/README.md`'s two-pass deploy.
3. **Google Maps** — replace
   `frontend/src/components/planner/MapPlaceholder.jsx` and the
   frontend-only `cx`/`cy` pixel coords (`frontend/src/lib/mapLayout.js`)
   with real `lat`/`lng` + the Maps JS API — see the design handoff's
   `design_system/readme.md` "Map provider" section for exact styling.
4. **Photo picker** — not designed yet; flag to design before building.
5. **Harden infra for real user data** — `infra/README.md`'s "Known
   simplifications".
6. **Tests** — `backend-ci.yml` runs `pytest` but there's no suite yet
   (`continue-on-error: true` — remove once tests exist).

