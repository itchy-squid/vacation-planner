# Vacation Planner

A collaborative vacation planner for mobile web. A group collects places
they want to go as pins on a Pinterest-style board; the trip then moves into
scheduling, where pins are dragged onto free-length blocks on a day
timeline, and contested blocks are resolved by comparing candidate *sets* of
places on a shared map, with per-set votes, comments, and an owner lock.

Design source: the handoff in `.claude/claude-design.zip` (design system
tokens + two `.dc.html` prototypes). See that bundle's own README for the
full screen-by-screen spec — this README covers the codebase, not the
design.

## Stack

- **Frontend**: React + Vite, plain CSS custom properties (no UI framework)
  — matches how the design tokens are structured. `frontend/`
- **Backend**: FastAPI on uvicorn, SQLAlchemy 2.0 + Alembic, deployed as an
  Azure Container App. `backend/`
- **Database**: Azure Database for PostgreSQL Flexible Server.
- **Auth**: Azure Container Apps built-in auth ("Easy Auth") with Microsoft
  Entra ID — not turned on yet, but the backend is written to trust it (see
  `backend/app/auth.py`).
- **Infra**: Bicep (`infra/`), deployed via GitHub Actions (`.github/workflows/`).

## Current state — read this before assuming something works

The frontend and backend are wired together — this is no longer two halves
built in isolation:

1. **Frontend**: the 7 screens from the original design handoff are
   implemented, plus a few added since that the handoff doesn't cover (see
   "Added beyond the design handoff" below). Trips, contributors, pins,
   votes, locks, and comments all come from — and persist to — the real
   Postgres-backed API (`frontend/src/state/PlannerContext.jsx`,
   `frontend/src/lib/api.js`). Nothing in `frontend/src/data/*.js` is live
   mock content anymore: `pins.js` and `contributors.js` are dead code kept
   only as a readable record of the original sample content (each file
   says so in its own header comment); `trip.js` (day-of-week labels for
   the schedule strip) and `schedule.js` (decorative non-contested-block
   content) are still genuinely local-only by design — the backend has
   nothing to persist that content to yet.
2. **Backend**: full Postgres schema, Easy-Auth-aware identity, a working
   set of Alembic migrations, and REST endpoints for everything the
   frontend now uses — trips (including creating and editing one), pins
   (including adding one from a link), contributors, blocks/votes/locks,
   and comments. The one piece still unused: `GET /api/trips/{id}/events`
   (SSE, `backend/app/routers/events.py`) exists server-side, but nothing
   in the frontend opens an `EventSource` yet, so another contributor's
   changes don't show up without a manual reload — see "Next steps".
3. **Infra**: Bicep templates are written and validated (`bicep build` /
   `bicep lint`, zero errors) but **nothing has been deployed to a real
   Azure subscription**. See `infra/README.md` for the one-time manual
   setup (resource group, Entra app registration) a deploy needs first.

Not yet designed at all, per the design handoff itself: drag-and-drop from
the tray onto the timeline (only the drop targets are drawn), a real
comment-thread view (comments are counts + single quoted lines today), the
photo-picker flow for choosing a pin's photo from a pinned link, and
invite/permissions/login screens.

### Added beyond the design handoff

These exist because the app needed to be usable beyond the one seeded
Taiwan trip — they aren't in the handoff's screen-by-screen spec, so treat
them as engineering additions rather than design-reviewed screens:

- **Creating a trip** (`frontend/src/pages/NewTrip.jsx`,
  `POST /api/trips`) — the creator becomes its owner-contributor.
- **Switching the active trip** from Trips Home's "Also planning" rail
  (`PlannerContext`'s `OPEN_TRIP` action) — opens that trip's own board,
  map, and schedule instead of the one loaded at mount. There's still no
  way to edit a trip you haven't switched to first.
- **Adding a pin from a link** (`frontend/src/pages/NewPin.jsx`,
  `POST /api/trips/{id}/pins`) — hands off to the existing Edit Visit
  screen for duration/cost/notes/tags. The board's region filter chips are
  derived from the active trip's actual pins now, not a fixed list.
- **Trip settings** (`frontend/src/pages/TripSettings.jsx`,
  `PATCH /api/trips/{id}`) — editing a trip's name, regions, and
  start/end dates after creation, reachable from the Board/Map/Schedule
  header (`components/core/SettingsButton.jsx`). Trip dates are real
  `start_date`/`end_date` columns (see the `b3eefc046a80` migration), not
  the free-text label the schema originally shipped with; day-of-trip
  scheduling (Day 5, availability rules) intentionally still doesn't
  derive from them — see `formatDateRange` in `frontend/src/lib/format.js`.

## Repo layout

```
frontend/          React + Vite app (see frontend/src/pages — the 7 design screens plus a few added since, see "Added beyond the design handoff")
backend/           FastAPI app, Alembic migrations, Dockerfile
infra/             Bicep templates + infra/README.md (manual setup steps)
.github/workflows/ CI (lint/build) + deploy (build image, apply Bicep, deploy frontend)
docker-compose.yml Local Postgres only — see "Local development"
.env.example       Copy to .env for local dev; see comments inline
```

## Local development

Every command below is written to run unchanged in bash, zsh, or Windows
PowerShell. The one thing to watch on Windows: if you're on PowerShell 5.1
(the default `powershell.exe`, as opposed to PowerShell 7+'s `pwsh`), `&&`
isn't a valid statement separator — run multi-step one-liners as separate
lines instead, as shown below.

**Frontend** (same on every platform)
```
cd frontend
npm install
npm run dev        # http://localhost:5173
```
A small fixed strip at the bottom of the screen (`frontend/src/dev/DevNav.jsx`)
lets you jump between the 7 screens directly — it's explicitly **not part
of the design**, just scaffolding for reviewing this pass. Delete it once
real trip-level navigation exists.

**Backend — requires Docker Desktop running** (for the local Postgres
container; if you don't have it, point `DATABASE_URL` at a Postgres
instance you do have instead and skip the `docker compose` line)

Dependencies are managed with [uv](https://docs.astral.sh/uv/) rather than
raw pip/venv — `uv sync` creates and populates `.venv` in one step, and
`uv run <command>` runs inside it without an activation step, so the same
commands work identically in bash, zsh, and Windows PowerShell (no
`source .venv/bin/activate` vs `.venv\Scripts\Activate.ps1` split, and no
"source: command not found" surprises on Windows). If you don't have `uv`
yet: `pip install uv`, or see
[the install docs](https://docs.astral.sh/uv/getting-started/installation/)
for a platform-native installer.

```
docker compose up -d db                 # local Postgres on :5432
cd backend
uv sync --group dev
cp ../.env.example ../.env              # Windows: Copy-Item ..\.env.example ..\.env — then edit as needed
uv run alembic upgrade head
uv run uvicorn app.main:app --reload    # http://localhost:8000/docs
```

With no Easy Auth in front of it locally, the backend attributes requests
to `DEV_USER_EMAIL` (see `.env.example`) automatically.

## Deployment

See `infra/README.md` for the full one-time setup (resource group, Entra ID
app registration for Easy Auth, required GitHub secrets). Once that's done,
pushing to `main` runs `.github/workflows/deploy.yml`: applies the Bicep
templates, builds and pushes the backend image via `az acr build`, points
the Container App at it, and deploys the built frontend to Azure Static Web
Apps.

**Assumption flagged for confirmation**: the frontend is deployed to
**Azure Static Web Apps** — this wasn't specified, and paired naturally
with a Container App backend + GitHub Actions. If a different target is
preferred (the same Container Apps environment as a second container,
Azure Storage + CDN, etc.), `.github/workflows/deploy.yml`'s `frontend` job
and `infra/modules/static-web-app.bicep` are the two places to change.

## Next steps

Roughly in the order they unblock each other:

1. **Live updates via SSE.** REST wiring is done (see "Current state"
   above) but `GET /api/trips/{id}/events` isn't consumed anywhere in the
   frontend yet — subscribing to it (`PlannerContext.jsx`) is what makes
   another contributor's votes, locks, comments, and pin edits show up
   without a manual reload.
2. **Turn on Easy Auth**: follow `infra/README.md`'s two-pass deploy (once
   without `entraClientId` to get the Container App's fqdn, register the
   Entra app, redeploy with real values).
3. **Google Maps**: replace `frontend/src/components/planner/MapPlaceholder.jsx`
   and the frontend-only `cx`/`cy` pixel coordinates
   (`frontend/src/lib/mapLayout.js`) with real `lat`/`lng` + the Google
   Maps JS API — the design handoff's `design_system/readme.md` "Map
   provider" section specifies the exact styling (pale desaturated
   basemap, `AdvancedMarkerElement`, Directions API for routes) this needs
   to match.
4. **Photo picker**: not designed yet per the handoff — flag it to whoever
   owns the design before building it; placeholders are the intended
   fallback state, not a stopgap to rush past.
5. **Harden infra for real user data**: see `infra/README.md`'s "Known
   simplifications" (Postgres public access, ACR admin credentials,
   single-replica SSE).
6. **Tests**: `backend-ci.yml` runs `pytest` but there isn't a test suite
   yet (`continue-on-error: true` on that step — remove it once tests
   exist).

## A note on git

This repo was initialized without a commit — no git identity (`user.name`/
`user.email`) was configured on this machine, and per this assistant's
safety rules it doesn't set git config on your behalf. Set your identity
and make the first commit yourself:
```
git config user.name "Your Name"
git config user.email "you@example.com"
git add .
git commit -m "Initial scaffold: React frontend wired to FastAPI backend, Bicep infra, CI/CD"
```
