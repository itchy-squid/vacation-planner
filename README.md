# Vacation Planner

A collaborative vacation planner for mobile web. A group collects places
they want to go as pins on a Pinterest-style board; the trip then moves into
scheduling, where pins are dragged onto free-length blocks on a day
timeline, and contested blocks are resolved by comparing candidate *sets* of
places on a shared map, with per-set votes, comments, and an owner lock.

Design source: the handoff in `.claude/claude-design.zip` (design system
tokens + two `.dc.html` prototypes) — see that bundle's own README for the
full screen-by-screen spec. A second handoff,
`.claude/Vacation planning site features.zip`, adds the Expenses screen,
the four-step proposal flow and the favicon; its implementation contract
is `docs/features/proposals-and-expenses-feature-spec.md`, which wins
wherever the two differ.

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

1. **Frontend**: the 7 design-handoff screens are implemented, plus
   Expenses and the four-step "propose a block" flow from the second
   handoff, plus a few added since (see "Added beyond the design
   handoff"). Trips,
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

The **Map** tab (`frontend/src/pages/TripMap.jsx`, `/trips/:tripId/map`)
replaced the old Lasso Map prototype. Ideas with an exact spot (added by
place search, or pinned from the tab) are dots. Ideas without one, like a
tour booked on Viator, are counted in a badge in their region's area. Each
region's location is looked up on Google once and stored for the trip
(`trip_regions`, `backend/app/routers/regions.py`). Without a Maps key the
tab says the map isn't switched on. See "Google Maps" below.

### Google Maps

The frontend needs a **browser key** baked in at build time:

1. In Google Cloud, enable the **Maps JavaScript API**, the **Geocoding
   API**, **Places API (New)** and the **Routes API** on a project with
   billing. Places is the search behind adding a pin
   (`frontend/src/lib/places.js`); without it the search says it isn't
   working, and adding by hand still works. Routes times the rides in a
   trip planned from the Map tab (`frontend/src/lib/routeEstimates.js`);
   without it each ride says it couldn't get times from Google. The day's
   Travel form uses both: Places finds a typed from and to, and Routes
   fills in how long (`frontend/src/components/planner/useTravelEstimate.js`).
2. Create an API key. Restrict it to those four APIs, and to HTTP referrers:
   `http://localhost:5173/*` plus each environment's frontend URL (e.g.
   `https://vacations.dev.amandasanti.com/*`). The key ships in the built
   JS, as every Maps JS key does, so these restrictions are what protect it.
3. Optionally create a **Map ID** so the map matches the app's quiet
   palette. Without one, Google's default style is used. Create a map style
   (Google Maps Platform → Map Styles) and set:
   - land: `#f4f3f5` (the app's page background, `--stone-100`)
   - water: `#aecfd8` (a light version of the app's teal, `--teal-600`)
   - roads: white, and highways `#e6e4e9`
   - labels: `#6f6d78` (`--text-secondary`)
   - businesses and other points of interest: hidden, since the app's own
     pins will go on top
   Then create a Map ID (Map Management → Create map ID, type JavaScript),
   link the style to it, and use that ID as `GOOGLE_MAPS_MAP_ID`. Later
   style changes apply without a redeploy. Drawing the app's own pins will
   need a Map ID anyway.
4. Locally, set `GOOGLE_MAPS_API_KEY` (and `GOOGLE_MAPS_MAP_ID`) in
   `frontend/.env.local`. They keep their plain names rather than Vite's
   `VITE_` prefix; `frontend/vite.config.js` passes exactly these two
   through to the browser. For deploys, set them on each GitHub
   Environment (`dev`, `prod`): the key as a **secret**, the Map ID as a
   **variable**:
   ```sh
   gh secret set GOOGLE_MAPS_API_KEY --env dev --body <key>
   gh variable set GOOGLE_MAPS_MAP_ID --env dev --body <map id>
   ```
   Keeping the key a secret masks it in logs, though it still ships in the
   built JS like any Maps browser key; the referrer restrictions are what
   protect it.

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
- **Bottom navigation** (`frontend/src/components/core/BottomNav.jsx`) —
  a fixed strip linking Home, Board, Schedule, Compare (when a contest is
  open) and Final. Started as the dev-only `src/dev/DevNav.jsx` jump strip
  and is now the app's permanent trip-level navigation; its styling is
  still the scaffold's and hasn't been through design. The Lasso Map is
  intentionally not in it — see below.
- **Trip settings** (`frontend/src/pages/TripSettings.jsx`,
  `PATCH /api/trips/{id}`) — name, regions, start/end dates, reachable
  from the Board/Map/Schedule header (`components/core/SettingsButton.jsx`).
  A trip has dates, or a length and rough month for planning before they're
  known — see "Planning by day of the trip" below.
- **Where we'll be** (`frontend/src/pages/DayPlaces.jsx`,
  `/trips/:tripId/places`; `backend/app/routers/day_places.py`) — the place
  the group stays in each day, plus day trips (there and back the same
  day). Stored by day of the trip in `trip_day_places`; set from the Plan tab's day
  header or the whole-trip list, several days at once, with Undo. Once a
  day is set, the Plan tab's header, day strip and "+ Add" filter use it
  instead of guessing from the calendar. Planners and owners change it;
  everyone can see it. Design: the project's `day-places-mockups` doc.
- **Stays and prices per day** (`Pin.kind`, `Pin.cost_per`;
  `frontend/src/lib/dailyCosts.js`) — an idea is either something to do
  or somewhere to stay. A stay has no duration and can't go on the
  calendar (`routers/plans.py validate_placement`); it's picked as the
  day's "Staying at" instead, and stays are offered there first. A price
  is paid once or per day, meaning per 24 hours: n days from first to last
  is n − 1 days of it. A stay's days are its nights in Where we'll be;
  anything else (a rental car) picks a first and last day. Both are
  counted once for the whole trip on Expenses ("Stays and daily costs"),
  so a plan stop for a per-day idea costs nothing of its own
  (`derive.py item_money`). Design: 1a in
  `Claude outputs/stays-costs-types-mockups.html`.
- **Tickets, passes and rentals** (`Pin.kind = "expense"`;
  `frontend/src/components/expenses/CostSheet.jsx`) — a cost that isn't a
  place is added on Expenses ("Add an expense", or "Add as
  a cost" from New idea's search) and never appears on the Ideas board,
  the map or the calendar: the frontend keeps these in `state.costs`, apart
  from `state.pins`. It's paid once (falling on its first day) or per day,
  for everyone or only some travelers (`Pin.traveler_ids`). A pass can
  cover ideas (`Pin.covers_pin_ids`): those places get a ticket badge on
  the board, and on their plans the pass holders don't pay the place's
  own price on the pass's days (`derive.py pass_holders`). Design:
  `Claude outputs/daily-expenses-mockups.html`.
- **Planning by day of the trip** (`backend/app/tripdays.py`,
  `frontend/src/lib/tripWhen.js`) — a new trip can be "Not sure yet": a
  length (`Trip.length_days`) and an optional rough month instead of dates.
  Everything on the calendar is stored relative to the trip, not the
  calendar: plans, votes and splits as `start_min`/`end_min` (minutes from
  00:00 on day 1), places, per-day costs and availability as day numbers
  (1 is the first day). Setting dates on a trip planned by length needs no
  question. Moving the start date from one date to another with anything
  on the calendar asks first (`components/trip/MoveDatesSheet.jsx`):
  shift the plan with the trip, or keep things on their dates
  (`PATCH /api/trips/{id}` `move: "shift" | "keep_dates"`; without it the
  API answers 409 `move_required`). Whatever ends up outside the trip's
  days is kept, and the Plan tab says so and can clear it. Design:
  `Claude outputs/flexible-dates-mockups.html`.

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
3. **Google Maps** — the Map tab uses the real Maps JS API
   (`frontend/src/components/map/MapCanvas.jsx`). Still to do: put pins on
   it once they have `lat`/`lng` (place search and backfill), then swap
   Compare's `MapPlaceholder.jsx` and the frontend-only `cx`/`cy` pixel
   coords (`frontend/src/lib/mapLayout.js`) for `MapCanvas`.
4. **Photo picker** — not designed yet; flag to design before building.
5. **Harden infra for real user data** — `infra/README.md`'s "Known
   simplifications".
6. **Widen the test suite** — `backend/tests/` now covers the scheduling
   rules (window contests, capture, drafts, locking, derived values) and
   `backend-ci.yml` treats a failure as a failure. Nothing covers the
   frontend yet.
7. **Real currency** — Expenses hardcodes `USD` (see
   `docs/features/proposals-and-expenses-feature-spec.md` decision 10);
   the schema has nowhere to put a trip's currency.
8. **A pinned item inside a claimed window** — the proposal flow's hour
   picker clips at a locked plan rather than packing stops around one
   (decision/§6.5). Supporting it would make "stops pack end to end"
   conditional, which is why v1 doesn't.

