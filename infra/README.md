# Infrastructure (Bicep)

Provisions everything the app needs on Azure: a Container Apps environment
running the FastAPI backend, Azure Database for PostgreSQL Flexible Server,
an Azure Container Registry, a Log Analytics workspace, and a Static Web
App for the built frontend.

```
infra/
  main.bicep                  # orchestrates the modules below (resource-group scope)
  main.parameters.json        # dev environment defaults; pass secrets via CLI/CI instead
  main.parameters.prod.json   # prod environment defaults; pass secrets via CLI/CI instead
  modules/
    log-analytics.bicep
    container-registry.bicep
    postgres.bicep               # Microsoft Entra ID auth only — no Postgres passwords
    managed-identity.bicep       # user-assigned identity the backend uses to reach Postgres
    container-apps-env.bicep
    container-app-backend.bicep   # includes the Easy Auth (Entra ID) authConfig
    static-web-app.bicep
  sql/
    provision_roles.sql       # one-time database role/privilege setup — see below
```

Validated with the standalone Bicep CLI (`bicep build` / `bicep lint`) —
zero errors or warnings.

## Environments

`main.bicep` takes an `appName` (default `vacationplanner`) and an
`envName` (`dev` or `prod`). Every resource name is built from a `suffix`:
**prod gets no environment suffix at all** — `envName=prod` names things
just `vacationplanner` — while **dev is suffixed** — `envName=dev` names
things `vacationplanner-dev`. This keeps the two environments in entirely
separate resources (and, if you follow the resource-group naming below,
entirely separate resource groups) so nothing dev does can touch prod.

| | dev | prod |
|---|---|---|
| Parameters file | `infra/main.parameters.json` | `infra/main.parameters.prod.json` |
| Resource group | `rg-vacationplanner-dev` | `rg-vacationplanner` |
| Log Analytics, Postgres, Container Apps env, backend Container App, Static Web App | `vacationplanner-dev` | `vacationplanner` |
| Container Registry (alphanumeric only) | `vacationplannerdevacr` | `vacationplanneracr` |
| Managed identity | `id-vacationplanner-dev` | `id-vacationplanner` |

Different resource *types* sharing the exact same base name is fine in
Azure — names are only unique within a resource type/scope, not across
types — so this is deliberate, not an oversight.

Deploy either one with the same command, just swapping the resource group
and parameters file — see "Deploy the infrastructure" below. CI
(`.github/workflows/deploy.yml`) picks the same two environments — see
"Continuous deployment" below.

## Managed identity database auth

Every database connection uses Microsoft Entra ID (Azure AD) authentication
— there is no Postgres password, anywhere, for anyone or anything:

- **The app** connects as its own user-assigned managed identity
  (`infra/modules/managed-identity.bicep`, attached to the Container App in
  `infra/modules/container-app-backend.bicep`). `backend/app/db.py`
  (`install_azure_ad_token_provider`) fetches a fresh Entra access token per
  connection instead of reading a password — see that file's docstring.
- **You and other maintainers** connect with your own Entra sign-in (e.g.
  `az login`, then a Postgres client that passes the resulting access token
  as the password — see "Connecting as a maintainer" below).
- The Postgres server itself is provisioned with `authConfig.passwordAuth:
  'Disabled'` (`infra/modules/postgres.bicep`) — password auth is turned
  off at the server level, not just unused by convention.

Table-level privileges follow the "one owner role" pattern from these two
articles:
[PostgreSQL Basics: A Template for Managing Database Privileges](https://www.red-gate.com/simple-talk/databases/postgresql/postgresql-basics-a-template-for-managing-database-privileges/)
and
[PostgreSQL Object Ownership and Default Privileges](https://www.red-gate.com/simple-talk/featured/postgresql-basics-object-ownership-and-default-privileges/) —
a single `db_owner` group role owns every table, and people/services get
privileges by being granted membership in a role, never by owning objects
themselves. Since table ownership can't be changed after the fact without
an explicit `ALTER ... OWNER TO` (and doing that routinely, once there's
real data, isn't something you want to build a workflow around), this
sidesteps the question entirely: ownership never needs to move, because
the same group role has owned everything since the first migration.

The full role setup — `db_owner`, `db_rw`, mapping your own Entra
identity and the app's managed identity to Postgres roles, and how to add
a maintainer later — is in **`infra/sql/provision_roles.sql`**, which you
run once by hand (see below) since it's a database-level operation, not
something Bicep/ARM has a resource type for.

## One-time manual setup

These steps aren't automated by Bicep because they involve choices only a
human should make (subscription, resource group naming, whose Entra
identity is the admin).

1. **Create a resource group** for the environment you're deploying:
   ```
   az group create -n rg-vacationplanner-dev -l <region>   # dev
   az group create -n rg-vacationplanner -l <region>        # prod
   ```

2. **Find your own Microsoft Entra object ID** (you'll be the Postgres
   AAD Administrator):
   ```
   az ad signed-in-user show --query id -o tsv
   ```
   Put that value, and your email/UPN, into `infra/main.parameters.json`'s
   `postgresAadAdminObjectId` / `postgresAadAdminPrincipalName` (or pass
   them via `--parameters` / CI secrets instead — they aren't secret
   values, just not worth committing a real one to source control).

3. **Register an Entra ID app for Easy Auth** (App registrations → New
   registration in the Azure portal, or `az ad app create`). This is what
   lets Azure Container Apps' built-in auth sign users in with Entra ID —
   see `backend/app/auth.py` for how the backend consumes it. (This is
   unrelated to the database auth above — Easy Auth is for people signing
   into the app in their browser, not for the backend talking to Postgres.)
   - Redirect URI: `https://<your-container-app-fqdn>/.auth/login/aad/callback`
     (you'll know the fqdn only after the first deploy without auth — see
     step 5 — so this is a two-pass setup: deploy once with
     `entraClientId` empty, note the fqdn, register the app, redeploy with
     the real `entraClientId`/`entraClientSecret`/`entraTenantId`.)
   - Create a client secret under "Certificates & secrets".
   - Note the Application (client) ID, the secret value, and your tenant ID.

4. **Push a real backend image** to the registry this deployment creates
   (or let `.github/workflows/deploy.yml` do it) before the Container App
   will serve real traffic — `main.bicep`'s default image is a placeholder.

5. **Deploy the infrastructure** — for dev:
   ```
   az deployment group create \
     -g rg-vacationplanner-dev \
     -f infra/main.bicep \
     -p infra/main.parameters.json \
     -p entraClientId='' # first pass: leave empty, deploy, note the backend fqdn
   ```
   or for prod:
   ```
   az deployment group create \
     -g rg-vacationplanner \
     -f infra/main.bicep \
     -p infra/main.parameters.prod.json \
     -p entraClientId=''
   ```
   Then re-run the same command with `entraClientId`, `entraClientSecret`,
   and `entraTenantId` set once the app registration exists. Note the
   `backendIdentityObjectId` and `postgresFqdn` outputs — you need both
   for the next step. Repeat steps 2, 3, 6, and 7 independently for each
   environment — dev and prod each get their own Entra app registration,
   Postgres roles, and migration run, since they're entirely separate
   resources.

6. **Provision the database roles** — connect to the new server as
   yourself (you're already its Entra Administrator, from step 2) and run
   `infra/sql/provision_roles.sql`, filling in your own object ID and the
   `backendIdentityObjectId` output where the script asks for them:
   ```
   PGPASSWORD="$(az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)" \
     psql "host=<postgresFqdn output> dbname=vacation_planner user=<your-email> sslmode=require" \
     -f infra/sql/provision_roles.sql
   ```
   (Access tokens are short-lived — if `psql` reports an auth failure,
   just re-run the `az account get-access-token` part and retry.)

7. **Run the migration** against the now-provisioned database — same
   connection approach as step 6, but pointed at the backend:
   ```
   cd backend
   DATABASE_URL="postgresql+psycopg://<your-email>@<postgresFqdn output>:5432/vacation_planner?sslmode=require" \
     USE_AZURE_AD_AUTH=true \
     uv run alembic upgrade head
   ```
   `USE_AZURE_AD_AUTH=true` makes `alembic/env.py` fetch your `az login`
   token instead of expecting a password in `DATABASE_URL` (there is none —
   password auth is disabled on the server). Every table this creates will
   be owned by `db_owner` and immediately readable/writable by the app,
   thanks to the default privileges `provision_roles.sql` already set up.

## Continuous deployment

`.github/workflows/deploy.yml` runs this same Bicep deployment (plus the
backend image build/push and the frontend build/deploy) automatically, but
it needs one-time setup per environment before its first run:

1. **Create two GitHub Environments** named exactly `dev` and `prod`
   (repo Settings → Environments → New environment). Each one holds its
   own copies of every secret listed at the top of `deploy.yml`
   (`AZURE_CREDENTIALS`, `AZURE_RESOURCE_GROUP`, `ACR_NAME`,
   `CONTAINER_APP_NAME`, `POSTGRES_AAD_ADMIN_OBJECT_ID`,
   `POSTGRES_AAD_ADMIN_PRINCIPAL_NAME`, the optional `ENTRA_*` ones, and
   `AZURE_STATIC_WEB_APPS_API_TOKEN`) — set as *environment* secrets, not
   repo-level secrets, so dev and prod never share a value. Point dev's
   copies at the `rg-vacationplanner-dev` resources and prod's at the
   `rg-vacationplanner` ones from the steps above.
2. **Optionally add a required reviewer** on the `prod` environment
   (same Settings page) if you want a person to approve every prod
   deployment before it runs.

Once that's set up:

- **Every push to `main` deploys dev automatically** — no approval
  needed, matching how the workflow behaved before dev/prod existed.
- **Prod only deploys when you trigger it by hand**: Actions tab →
  "Deploy" → "Run workflow" → pick `prod` from the environment dropdown.
  There's no branch that deploys prod on its own, so a prod release is
  always a deliberate action (and will pause for approval first, if you
  added a required reviewer above).

## Adding a maintainer

See `infra/sql/provision_roles.sql`'s "Adding a maintainer later" section.
Short version: any current maintainer can grant the next one full
ownership-equivalent access with one `GRANT db_owner TO ...` — the only
step that needs the Entra Administrator specifically is mapping a
brand-new person's Entra identity to a Postgres role in the first place
(one `SELECT pgaadauth_create_principal_with_oid(...)` call). The same
file also documents an alternative that removes even that step, by mapping
an Entra security group to the role instead of individual people.

## Connecting as a maintainer

Any Postgres client works, as long as it sends your Entra access token as
the password instead of a real one (password auth is disabled server-side,
so a real password wouldn't work anyway):

```
az login
PGPASSWORD="$(az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)" \
  psql "host=<postgresFqdn> dbname=vacation_planner user=<your-email> sslmode=require"
```

Tokens expire in about an hour — re-run the `az account get-access-token`
line and reconnect if you get an authentication error partway through a
session.

## Known simplifications (flagged for later hardening)

- **Postgres is publicly reachable** (with an "allow Azure services"
  firewall rule) rather than VNet-integrated with a private endpoint.
  Fine for a first deployment; tighten before real user data goes in. (This
  is orthogonal to the AAD-only auth above — no password exists to leak
  either way, but network exposure is still worth narrowing later.)
- **ACR uses admin credentials**, not a managed identity pull. Simpler for
  a first CI/CD pass; switch the Container App to a user-assigned managed
  identity with `AcrPull` on the registry when ready (it already has one
  user-assigned identity, from the database-auth setup above — this would
  reuse it, or add a second one).
- **SSE fan-out is in-memory and single-replica** (see
  `backend/app/events.py`). `maxReplicas: 3` in `container-app-backend.bicep`
  is fine for CPU/HTTP scaling today because nothing depends on which
  replica handles a request yet — but it does mean an SSE client can
  connect to a replica that never sees another replica's event. Before
  relying on live updates in production, either pin to `maxReplicas: 1` or
  move the event bus to something shared (Azure Web PubSub or Redis).
