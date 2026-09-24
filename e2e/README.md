# End-to-end tests

Playwright tests that drive the real app in a browser: the deployed **dev**
site in CI, or a local stack while writing tests. They sign in as one
dedicated **test account**, and every trip they touch is one that account
made in this run.

## Keeping to the test account's own data

- **One account.** Global setup checks `GET /api/me` and stops if the
  session belongs to anyone but `E2E_ACCOUNT_EMAIL`.
- **Only its own trips.** Tests seed through the public API as that account
  (`support/seed.js`), each into a fresh trip named `E2E · <test> · <run id>`.
  The account is the trip's only member; the other travelers in it
  (Ana, Lin, Jae...) are plain names with no accounts behind them.
- **Cleanup that can't reach anyone else.** Cleanup is `DELETE /api/me`,
  which, for an account that only owns trips nobody else is on, deletes
  exactly those trips. Before every cleanup (at the start of a run, to
  sweep up after a crashed run, and at the end) the suite reads
  `GET /api/me/deletion-preview` and refuses to delete anything if the
  account is on a trip it doesn't own alone or a trip whose name doesn't
  start with `E2E · `. So never invite the test account to a real trip.
- **Never prod.** The suite refuses to run against
  `vacations.amandasanti.com` / `vacations-api.amandasanti.com`
  (`E2E_FORBIDDEN_HOSTS`).

## One-time setup

1. **Make the test account.** Dev signs in with personal Microsoft accounts
   (Easy Auth, `consumers` endpoint), so create a new outlook.com account
   just for this, e.g. `vacation-planner-e2e@outlook.com`. Don't use your
   own.
2. **Sign it in and save the session.**
   ```sh
   cd e2e
   npm install
   npx playwright install chromium
   E2E_BASE_URL=https://vacations.dev.amandasanti.com \
   E2E_API_URL=https://vacations-api.dev.amandasanti.com \
   E2E_ACCOUNT_EMAIL=vacation-planner-e2e@outlook.com \
   npm run login
   ```
   A browser opens; sign in as the test account. The Easy Auth session is
   saved to `.auth/session.json` (git-ignored).
3. **Give it to CI**, on the `dev` GitHub Environment:
   ```sh
   gh secret set E2E_AUTH_STATE --env dev < .auth/session.json
   gh variable set E2E_ACCOUNT_EMAIL --env dev --body vacation-planner-e2e@outlook.com
   ```

The session is good for **30 days** from sign-in (Easy Auth's fixed cookie
lifetime, `sessionLifetime` in `infra/modules/container-app-backend.bicep`).
When it runs out, the suite fails at setup saying so: repeat steps 2 and 3.

## Running

Against dev, with the variables from step 2 set:

```sh
npm test               # headless
npm run test:headed    # watch it
npm run report         # last HTML report (CI uploads one on failure)
```

Against a local stack, which is quicker while writing a test: start the
backend with `DEV_USER_EMAIL=e2e@example.com` (the local stand-in for the
test account, and the email the suite expects when it's pointed at
localhost), start the frontend with `npm run dev`, then just `npm test`.
The same cleanup rules apply there, so use a database where
`e2e@example.com` isn't on any real trip. Use the docker-compose Postgres,
not SQLite: cleanup relies on the database's ON DELETE CASCADE for
travelers, which SQLite ignores unless foreign keys are switched on, and
the next run then fails creating a trip.

`E2E_KEEP_DATA=1` skips the final cleanup, to look at a failed test's trip
in the app afterwards. The next run clears it.

## CI

The `e2e` job in `.github/workflows/deploy.yml` runs after every deploy to
dev (i.e. on every PR), against what was just deployed. It's inside the
workflow's per-environment lock, so another PR can't redeploy dev halfway
through. It's skipped, with a warning, until `E2E_AUTH_STATE` is set.

Dev's backend scales to zero when idle, so the first request of a run can
wait out a cold start; setup retries 502/503/504 for up to three minutes.

## Writing tests

- Import `test` and `expect` from `support/fixtures.js`. The `seed`
  fixture makes a trip for the test (`seed({ travelers, pins, events })`)
  and returns ids by name; `api` is a signed-in API client for extra
  setup and for checking what the server stored.
- `tapCalendar(page, "10:00")` taps the day grid at that hour.
- Select by role and visible text, as a person would.
- Each test gets its own trip, so tests never depend on each other.
