# Infrastructure (Bicep)

Container Apps environment (FastAPI backend), Azure Database for
PostgreSQL Flexible Server, Container Registry, Log Analytics workspace,
Static Web App (frontend).

```
infra/
  main.bicep                  # orchestrates the modules below (resource-group scope)
  main.parameters.json        # dev defaults; pass secrets via CLI/CI
  main.parameters.prod.json   # prod defaults; pass secrets via CLI/CI
  modules/
    log-analytics.bicep
    container-registry.bicep
    postgres.bicep               # Entra ID auth only — no Postgres passwords
    managed-identity.bicep       # backend's identity for reaching Postgres
    container-apps-env.bicep
    container-app-backend.bicep   # includes Easy Auth (Entra ID) authConfig
    static-web-app.bicep
  sql/
    provision_roles.sql       # one-time database role/privilege setup — see below
```

Validated with `bicep build`/`bicep lint` — zero errors/warnings.

## Environments

`main.bicep` takes `appName` (default `vacationplanner`) and `envName`
(`dev`/`prod`). Prod gets no suffix; dev is suffixed `-dev` — deliberate,
keeps the environments in separate resources/resource groups.

| | dev | prod |
|---|---|---|
| Parameters file | `infra/main.parameters.json` | `infra/main.parameters.prod.json` |
| Resource group | `rg-vacationplanner-dev` | `rg-vacationplanner` |
| Log Analytics, Postgres, Container Apps env, backend Container App, Static Web App | `vacationplanner-dev` | `vacationplanner` |
| Container Registry (alphanumeric only) | `vacationplannerdev` | `vacationplanner` |
| Managed identity | `id-vacationplanner-dev` | `id-vacationplanner` |

Deploy either with the same command, swapping resource group and
parameters file — see "Deploy the infrastructure" below.
`.github/workflows/deploy.yml` uses the same two environments — see
"Continuous deployment".

## Managed identity database auth

Entra ID auth only — no Postgres password, anywhere:

- **The app** connects as its user-assigned managed identity
  (`infra/modules/managed-identity.bicep`, attached in
  `infra/modules/container-app-backend.bicep`). `backend/app/db.py`
  (`install_azure_ad_token_provider`) fetches a fresh Entra token per
  connection.
- **Maintainers** connect with their own Entra sign-in (`az login`, then a
  client passing the resulting access token as the password — see
  "Connecting as a maintainer").
- Postgres is provisioned with `authConfig.passwordAuth: 'Disabled'`
  (`infra/modules/postgres.bicep`).

Table privileges follow the "one owner role" pattern
([1](https://www.red-gate.com/simple-talk/databases/postgresql/postgresql-basics-a-template-for-managing-database-privileges/),
[2](https://www.red-gate.com/simple-talk/featured/postgresql-basics-object-ownership-and-default-privileges/)):
a single `db_owner` group role owns every table; people/services get
access via role membership, never object ownership — so ownership never
needs to move as maintainers change.

Full role setup (`db_owner`, `db_rw`, mapping your Entra identity and the
app's managed identity to Postgres roles, adding a maintainer later) is in
**`infra/sql/provision_roles.sql`**, run once by hand (database-level
operation, no Bicep/ARM resource type for it).

## One-time manual setup

1. **Create a resource group**:
   ```
   az group create -n rg-vacationplanner-dev -l <region>   # dev
   az group create -n rg-vacationplanner -l <region>        # prod
   ```

2. **Find your own Entra object ID** (you'll be the Postgres AAD
   Administrator):
   ```
   az ad signed-in-user show --query id -o tsv
   ```
   Not a Bicep parameter — passed directly to
   `az postgres flexible-server ad-admin create` in step 6.

3. **Register an Entra ID app for Easy Auth** (`az ad app create`, or App
   registrations in the portal) — separate from the database auth above;
   this is for users signing into the app (`backend/app/auth.py`).
   - Redirect URI: `https://<container-app-fqdn>/.auth/login/aad/callback`
     — known only after the first deploy without auth (step 5): two-pass
     setup, deploy once with `entraClientId` empty, note the fqdn,
     register the app, redeploy with real values.
   - Create a client secret under "Certificates & secrets".
   - Note the client ID, secret value, and tenant ID.

4. **Push a real backend image** to the registry (or let
   `.github/workflows/deploy.yml` do it) — `main.bicep`'s default image is
   a placeholder.

5. **Deploy the infrastructure** — dev:
   ```
   az deployment group create \
     -g rg-vacationplanner-dev \
     -f infra/main.bicep \
     -p infra/main.parameters.json \
     -p entraClientId='' # first pass: leave empty, note the backend fqdn
   ```
   prod:
   ```
   az deployment group create \
     -g rg-vacationplanner \
     -f infra/main.bicep \
     -p infra/main.parameters.prod.json \
     -p entraClientId=''
   ```
   Re-run with `entraClientId`, `entraClientSecret`, `entraTenantId` once
   the app registration exists. Note the `backendIdentityObjectId` and
   `postgresFqdn` outputs. Repeat steps 2, 3, 6, 7, 8 independently per
   environment.

6. **Create the Postgres Entra Administrator manually** — Bicep's
   `Microsoft.DBforPostgreSQL/flexibleServers/administrators` resource
   reliably fails with an opaque `InternalServerError` here (a known,
   unresolved Azure-side issue), so `main.bicep` doesn't provision it:
   ```
   az postgres flexible-server ad-admin create \
     -g rg-vacationplanner-dev \
     -s vacationplanner-dev \
     -i <postgresAadAdminObjectId from step 2> \
     -u <postgresAadAdminPrincipalName from step 2> \
     -t User
   ```
   (prod: `-g rg-vacationplanner -s vacationplanner`.)

7. **Provision the database roles** — connect as yourself (already the
   Entra Administrator from step 6) and run
   `infra/sql/provision_roles.sql`, filling in your object ID and the
   `backendIdentityObjectId` output:
   ```
   PGPASSWORD="$(az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)" \
     psql "host=<postgresFqdn output> dbname=vacation_planner user=<your-email> sslmode=require" \
     -f infra/sql/provision_roles.sql
   ```
   (Tokens are short-lived — re-run `az account get-access-token` and
   retry on an auth failure.)

8. **Run the migration**:
   ```
   cd backend
   DATABASE_URL="postgresql+psycopg://<your-email>@<postgresFqdn output>:5432/vacation_planner?sslmode=require" \
     USE_AZURE_AD_AUTH=true \
     uv run alembic upgrade head
   ```
   `USE_AZURE_AD_AUTH=true` makes `alembic/env.py` fetch your `az login`
   token instead of a password (there is none). Tables created are owned
   by `db_owner` and immediately usable by the app via
   `provision_roles.sql`'s default privileges.

## Continuous deployment

`.github/workflows/deploy.yml` runs this deployment automatically; needs
one-time setup per environment first:

1. **Create GitHub Environments** `dev` and `prod` (repo Settings →
   Environments), each with its own copies of the values below, pointed at
   that environment's resource group.
2. **Set up federated (OIDC) auth for GitHub → Azure**, once per
   environment.

   **Prerequisite:** GitHub's
   ["immutable subject claims"](https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/)
   rollout lets an OIDC token's `sub` claim embed numeric owner/repo IDs
   (`repo:<owner>@<owner_id>/<repo>@<repo_id>:environment:<env>`) instead
   of just names. Existing repos aren't switched over automatically (only
   repos created on/after July 15, 2026 are); opt-in is per-repo/org via
   Settings → Actions → General → OIDC, or the REST API — there's also a
   preview endpoint showing the exact subject string a token would carry,
   worth checking since a format mismatch fails silently (Azure just
   rejects the token). **Until opt-in is confirmed, use the name-based
   subject** (`repo:itchy-squid/vacation-planner:environment:$ENV`) — it
   still works either way.

   This repo's IDs, if/when needed: owner (`itchy-squid`) `86495347`,
   repo (`vacation-planner`) `1358795740`.

   ```
   ENV=dev   # then repeat with ENV=prod
   RG=rg-vacationplanner-dev   # rg-vacationplanner for prod

   APP_ID=$(az ad app create --display-name "gh-vacationplanner-$ENV-deploy" --query appId -o tsv)
   az ad sp create --id "$APP_ID"

   az role assignment create \
     --assignee "$APP_ID" \
     --role Contributor \
     --scope "/subscriptions/<subscription-id>/resourceGroups/$RG"

   az ad app federated-credential create --id "$APP_ID" --parameters '{
     "name": "github-actions-'"$ENV"'",
     "issuer": "https://token.actions.githubusercontent.com",
     "subject": "repo:itchy-squid/vacation-planner:environment:'"$ENV"'",
     "audiences": ["api://AzureADTokenExchange"]
   }'
   # once immutable subject claims are confirmed opted-in, use instead:
   #   "subject": "repo:itchy-squid@86495347/vacation-planner@1358795740:environment:'"$ENV"'",

   echo "DEPLOY_CLIENT_ID ($ENV) = $APP_ID"
   ```

   **Via the Entra admin center instead (no CLI)** — repeat for `dev` and
   `prod`. The portal wizard only ever produces the name-based subject; if
   this repo has opted into immutable subject claims, use the CLI block
   above instead for the federated-credential step.
   1. [entra.microsoft.com](https://entra.microsoft.com) → Identity → App
      registrations → New registration. Name `gh-vacationplanner-dev-deploy`
      (or `...-prod-deploy`), default org-only accounts, blank redirect
      URI, Register.
   2. Copy the **Application (client) ID** (`DEPLOY_CLIENT_ID`) and
      **Directory (tenant) ID** (`AZURE_TENANT_ID`, same both times).
   3. Certificates & secrets → Federated credentials → + Add credential →
      scenario **"GitHub Actions deploying Azure resources"**:
      - Organization: `itchy-squid`
      - Repository: `vacation-planner`
      - Entity type: **Environment**
      - GitHub environment name: `dev` (or `prod`)
      - Name: `github-actions-dev` (or `github-actions-prod`)

      Leave issuer/audience as auto-filled. This produces the name-based
      subject — fine unless immutable subject claims are opted in (then
      use the CLI block instead).
   4. Azure portal → Resource groups → `rg-vacationplanner-dev` (or
      `rg-vacationplanner`) → Access control (IAM) → Add role assignment
      → **Contributor** → select `gh-vacationplanner-dev-deploy` (or
      `-prod-deploy`) → Review + assign.
   5. `AZURE_SUBSCRIPTION_ID`: Azure portal → Subscriptions.
3. **Set the environment's variables and secrets**:
   - **Variables**: `DEPLOY_CLIENT_ID` (`$APP_ID`), `AZURE_SUBSCRIPTION_ID`,
     `AZURE_TENANT_ID` (one value covers GitHub login, Postgres AAD admin,
     and Easy Auth), `AZURE_RESOURCE_GROUP`, `ACR_NAME`,
     `CONTAINER_APP_NAME`, optional `EASY_AUTH_CLIENT_ID` (distinct app
     from `DEPLOY_CLIENT_ID`, same tenant). No `POSTGRES_ADMIN_*` — see
     "One-time manual setup" step 6.
   - **Secrets**: optional `EASY_AUTH_CLIENT_SECRET`, and
     `AZURE_STATIC_WEB_APPS_API_TOKEN` (from the Static Web App resource,
     after the first Bicep deploy).
4. **Optionally add a required reviewer** on `prod` for manual approval.

Once set up: every push to `main` deploys dev automatically; prod only
deploys via Actions tab → "Deploy" → "Run workflow" → `prod` (paused for
approval if a required reviewer is set).

## Custom domains

Neither app gets a custom domain by default — both use their
auto-generated hostname until `frontendCustomDomainName`/
`backendCustomDomainName` (`infra/main.bicep`) are set. Two-pass, same
shape as Easy Auth: deploy with the param empty to learn the hostname,
point DNS at it, redeploy with the param set.

For dev: `vacations.dev.amandasanti.com` (frontend),
`vacations-api.dev.amandasanti.com` (backend).

1. Deploy with both params empty (default). Note `frontendUrl`,
   `backendUrl`, and `backendCustomDomainVerificationId` outputs.
2. DNS records at whichever provider hosts `amandasanti.com`:

   | Record | Host | Value |
   |---|---|---|
   | CNAME | `vacations.dev` | `frontendUrl` output's hostname (strip `https://`) |
   | CNAME | `vacations-api.dev` | `backendUrl` output's hostname (strip `https://`) |
   | TXT | `asuid.vacations-api.dev` | `backendCustomDomainVerificationId` output |

   (Frontend needs no TXT/asuid record unless on the Enterprise edge SKU;
   backend always needs the TXT record.)
3. Wait for DNS to resolve (`dig CNAME vacations-api.dev.amandasanti.com`,
   `dig TXT asuid.vacations-api.dev.amandasanti.com`).
4. Redeploy with both params set:
   `-p frontendCustomDomainName=vacations.dev.amandasanti.com -p backendCustomDomainName=vacations-api.dev.amandasanti.com`
   (or add to `infra/main.parameters.json`). Free TLS certs issue
   automatically once validation succeeds; `deploy.yml` then builds the
   frontend against the new `backendUrl` with no further changes needed.

`corsOrigins` in `infra/main.parameters.json` is already set to
`https://vacations.dev.amandasanti.com` for dev, ahead of the custom
domain being bound — testing against the auto-generated hostname will
fail CORS until step 4 completes, or until `corsOrigins` temporarily
includes both hostnames.

## Adding a maintainer

See `infra/sql/provision_roles.sql`'s "Adding a maintainer later" section
— any current maintainer can `GRANT db_owner TO ...`; only mapping a
brand-new person's Entra identity to a Postgres role needs the Entra
Administrator (`SELECT pgaadauth_create_principal_with_oid(...)`). The
same file documents mapping an Entra security group to the role instead,
which removes even that step.

## Connecting as a maintainer

```
az login
PGPASSWORD="$(az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)" \
  psql "host=<postgresFqdn> dbname=vacation_planner user=<your-email> sslmode=require"
```
Tokens expire in about an hour — re-run `az account get-access-token` and
reconnect on an auth error.

## Known simplifications (flagged for later hardening)

- **Postgres is publicly reachable** ("allow Azure services" firewall
  rule), not VNet-integrated. No password to leak either way, but narrow
  network exposure before real user data.
- **ACR uses admin credentials**, not managed-identity pull. Switch the
  Container App to its existing user-assigned identity with `AcrPull`
  when ready.
- **SSE fan-out is in-memory, single-replica** (`backend/app/events.py`).
  `maxReplicas: 3` is fine for CPU/HTTP scaling today, but an SSE client
  can connect to a replica that never sees another replica's event. Pin
  to `maxReplicas: 1` or move to a shared event bus (Azure Web PubSub or
  Redis) before relying on live updates in production.
