# Infrastructure (Bicep)

Container Apps environment (FastAPI backend), Azure Database for
PostgreSQL Flexible Server, Container Registry, Log Analytics workspace,
Static Web App (frontend).

```
infra/
  main.bicep                          # orchestrates the modules below (resource-group scope)
  main.parameters.dev.bicepparam      # dev defaults; pass secrets via env vars/CLI/CI
  main.parameters.prod.bicepparam     # prod defaults; pass secrets via env vars/CLI/CI
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
| Parameters file | `infra/main.parameters.dev.bicepparam` | `infra/main.parameters.prod.bicepparam` |
| Resource group | `vacationplanner-dev` | `vacationplanner` |
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
   az group create -n vacationplanner-dev -l <region>   # dev
   az group create -n vacationplanner -l <region>        # prod
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
   - **Supported account types: Personal Microsoft accounts only**
     (`--sign-in-audience PersonalMicrosoftAccount`, or "Personal Microsoft
     accounts only" in the portal's registration screen) — this app is
     meant for anyone planning a trip with you, not just people in your
     own Entra tenant. `modules/container-app-backend.bicep`'s authConfig
     hardcodes the matching `/consumers` OIDC issuer, independent of
     `entraTenantId` — registering this app any other way (e.g. the
     portal's single-tenant default) fails sign-in at runtime with
     `AADSTS9002346` ("configured for use by Microsoft Account users
     only... use the /consumers endpoint") or its mirror image, depending
     on which side is mismatched.
   - Redirect URI: `https://<container-app-fqdn>/.auth/login/aad/callback`
     — known only after the first deploy without auth (step 5): two-pass
     setup, deploy once with `entraClientId` empty, note the fqdn,
     register the app, redeploy with real values.
   - Create a client secret under "Certificates & secrets".
   - Note the client ID and secret value (tenant ID isn't used here --
     see above).

4. **Push a real backend image** to the registry (or let
   `.github/workflows/deploy.yml` do it) — `main.bicep`'s default image is
   a placeholder.

5. **Deploy the infrastructure** — a `.bicepparam` file's own `using`
   statement already points at `main.bicep`, so `-f`/`--template-file`
   isn't needed, but the CLI only accepts one `--parameters`/`-p` when
   it's a `.bicepparam` file (unlike the old ARM-JSON files, you can't
   also tack on `-p key=value` overrides) — so `entraClientId`/
   `entraClientSecret` are read from environment variables inside
   `main.parameters.dev.bicepparam`/`main.parameters.prod.bicepparam`
   instead (see that file's comment). Leave them unset for the first
   pass:
   ```
   unset ENTRA_CLIENT_ID ENTRA_CLIENT_SECRET
   az deployment group create \
     -g vacationplanner-dev \
     -p infra/main.parameters.dev.bicepparam
   ```
   note the backend fqdn. prod:
   ```
   unset ENTRA_CLIENT_ID ENTRA_CLIENT_SECRET
   az deployment group create \
     -g vacationplanner \
     -p infra/main.parameters.prod.bicepparam
   ```
   Re-run once the app registration exists, this time with those two env
   vars set (and `entraTenantId` left to its `main.bicep` default of
   `subscription().tenantId`, unless you actually need a different
   tenant):
   ```
   export ENTRA_CLIENT_ID='...'
   export ENTRA_CLIENT_SECRET='...'
   az deployment group create -g vacationplanner-dev -p infra/main.parameters.dev.bicepparam
   ```
   Note the `backendIdentityObjectId` and `postgresFqdn` outputs. Repeat
   steps 2, 3, 6, 7, 8 independently per environment.

6. **Create the Postgres Entra Administrator manually** — Bicep's
   `Microsoft.DBforPostgreSQL/flexibleServers/administrators` resource
   reliably fails with an opaque `InternalServerError` here (a known,
   unresolved Azure-side issue), so `main.bicep` doesn't provision it:
   ```
   az postgres flexible-server ad-admin create \
     -g vacationplanner-dev \
     -s vacationplanner-dev \
     -i <postgresAadAdminObjectId from step 2> \
     -u <postgresAadAdminPrincipalName from step 2> \
     -t User
   ```
   (prod: `-g vacationplanner -s vacationplanner`.)

7. **Provision the database roles** — connect as yourself (already the
   Entra Administrator from step 6) and run
   `infra/sql/provision_roles.sql`, filling in your object ID, the
   `backendIdentityObjectId` output, AND the deploy service principal's
   object ID (do "Continuous deployment"'s step 2 first if you haven't —
   `az ad sp show --id "$DEPLOY_CLIENT_ID" --query id -o tsv` — this is
   what maps CI's identity to the "gh-deploy" Postgres role that runs
   migrations; skip it for now and come back to add just that one
   statement later if you're not setting up CI yet):
   ```
   PGPASSWORD="$(az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)" \
     psql "host=<postgresFqdn output> dbname=vacation_planner user=<your-email> sslmode=require" \
     -f infra/sql/provision_roles.sql
   ```
   (Tokens are short-lived — re-run `az account get-access-token` and
   retry on an auth failure.)

8. **Run the migration** — no manual command anymore. Nothing (not the
   app, not a maintainer) runs `alembic upgrade head` by hand; it runs in
   CI, connected as `gh-deploy`, in `.github/workflows/deploy.yml`'s
   `migrate` job — see "Continuous deployment" below. Once step 7 above
   has mapped `gh-deploy` and CI is set up, trigger a deploy (push to
   `main` for dev; run the "Deploy" workflow manually for prod) and the
   schema gets created for you, before the backend image ever goes live.
   Tables it creates are owned by `db_owner` and immediately
   usable by the app via `provision_roles.sql`'s default privileges. See
   `claude/db-privilege-provisioning.md` for why this replaced both
   the app migrating itself at container startup and a maintainer running
   it by hand.

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
   RG=vacationplanner-dev   # vacationplanner for prod

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

   # Also needed for infra/sql/provision_roles.sql's "gh-deploy" mapping
   # (the Deploy workflow's migrate job connects to Postgres as this
   # identity) -- note this is the SERVICE PRINCIPAL's object ID, not
   # $APP_ID (the application/client ID) and not the app registration's
   # own object ID:
   az ad sp show --id "$APP_ID" --query id -o tsv
   ```
   If `provision_roles.sql` was already run for this environment without
   the `gh-deploy` mapping (e.g. you set up CI after following "One-time
   manual setup"), go back and run just its `gh-deploy` `pgaadauth_create_
   principal_with_oid` and `GRANT db_owner TO "gh-deploy"` statements —
   connected the same way, as the Entra Administrator.

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
   4. Azure portal → Resource groups → `vacationplanner-dev` (or
      `vacationplanner`) → Access control (IAM) → Add role assignment
      → **Contributor** → select `gh-vacationplanner-dev-deploy` (or
      `-prod-deploy`) → Review + assign.
   5. `AZURE_SUBSCRIPTION_ID`: Azure portal → Subscriptions.
3. **Set the environment's variables and secrets**:
   - **Variables**: `DEPLOY_CLIENT_ID` (`$APP_ID`), `AZURE_SUBSCRIPTION_ID`,
     `AZURE_TENANT_ID` (covers GitHub login and Postgres AAD admin -- *not*
     Easy Auth, which signs in personal Microsoft accounts via the fixed
     `/consumers` endpoint regardless of tenant; see "One-time manual
     setup" step 3), `AZURE_RESOURCE_GROUP`, `ACR_NAME`,
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

The backend needs a third param, `backendBindCustomDomain`
(`bindCustomDomain` in `modules/container-app-backend.bicep`), left
`false` until the managed certificate has actually finished issuing —
Container Apps issues them asynchronously, and moving the ingress onto a
certificate before Azure finishes issuing it is a known source of
non-deterministic failures
([microsoft/azure-container-apps#796](https://github.com/microsoft/azure-container-apps/issues/796),
[#1652](https://github.com/microsoft/azure-container-apps/issues/1652) —
open upstream issues, not specific to this template). Static Web Apps has
no equivalent problem, so `frontendCustomDomainName` binds in one step.

(An earlier revision referenced the certificate via `managedCertificate.id`
directly in the ingress, which fails template validation —
`InvalidTemplate: The resource 'Microsoft.App/managedEnvironments/<name>'
is not defined in the template` — even with `customDomainName` left empty,
i.e. on every fresh environment's first-ever deploy. Cause: Bicep adds an
*unconditional* `dependsOn` the moment a resource is referenced by symbol
anywhere in another resource's body, regardless of what conditional
guards that reference — and the certificate only exists once
`customDomainName` is set. Fixed by building `certificateId` with a plain
`resourceId(...)` call instead of the symbolic `.id` accessor, which
carries no such side effect — see the comment in
`modules/container-app-backend.bicep`.)

For dev: `vacations.dev.amandasanti.com` (frontend),
`vacations-api.dev.amandasanti.com` (backend).

1. Deploy with all three params at their defaults (`frontendCustomDomainName`
   / `backendCustomDomainName` empty, `backendBindCustomDomain` false).
   Note `frontendUrl`, `backendUrl`, and `backendCustomDomainVerificationId`
   outputs.
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
4. Redeploy with `frontendCustomDomainName` and `backendCustomDomainName`
   set, `backendBindCustomDomain` still false. Binds the frontend's
   domain immediately; on the backend, creates + validates the managed
   certificate only — ingress doesn't move yet.
5. Confirm the certificate issued before touching `backendBindCustomDomain`:
   `az containerapp env certificate list -g vacationplanner-dev -n vacationplanner-dev -o table`
   — wait for `Succeeded` on `vacations-api.dev.amandasanti.com`.
6. Redeploy once more with `backendBindCustomDomain=true`. This moves the
   ingress onto the custom domain; `backendUrl` now resolves to it, and
   `deploy.yml` builds the frontend against that value automatically, no
   further changes needed.

If a managed certificate for `backendCustomDomainName` already exists in
the environment under a name this template didn't generate (e.g. one
created by `az containerapp hostname bind` instead of this rollout --
those auto-generate their own certificate name), step 6 fails with
`DuplicateManagedCertificateInEnvironment` (this template tries to create
a second certificate for the same subject name) plus `CertificateNotFound`
(ingress looks for the name this template expects, which was never
created). Rather than deleting and reissuing an already-validated
certificate, set `backendExistingCertificateResourceId`
(`infra/main.bicep`) to that certificate's full resource ID -- find it with
`az containerapp env certificate list -g <resource-group> -n <env-name> -o table`
-- and this template points ingress at it directly instead of trying to
create its own.

`corsOrigins` feeds the Container App ingress's own `corsPolicy` (`modules/container-app-backend.bicep`) -- the only place CORS is configured; the app itself (`backend/app/main.py`) runs no CORS middleware, and local dev avoids the question entirely via the Vite dev server's proxy (`frontend/vite.config.js`). It's already set to `https://vacations.dev.amandasanti.com` for dev, ahead of the custom domain being bound -- testing against whichever origin you're actually serving from partway through this rollout may fail CORS until step 6 completes, or until `corsOrigins` temporarily includes both hostnames.

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
- **Mirrored pin photos are never deleted from blob storage**
  (`backend/app/photo_storage.py`) — deleting a pin, or editing its photo
  to a different link, leaves the old blob behind. Photos are small and
  the container is private, so this is cost/hygiene debt, not a leak; add
  a delete alongside `DELETE /api/pins/{pin_id}` and the photo-edit path
  in `PATCH /api/pins/{pin_id}` before this matters at scale, or set a
  lifecycle-management rule on the container to age out anything unread
  for N days.
- **A pin's photo briefly shows the hotlinked source, then swaps to the
  mirrored copy** once the background copy in `routers/pins.py`'s
  `_mirror_pin_photo` finishes (seconds, typically) — by design, so
  adding a pin never waits on a slow third-party image host, but it does
  mean the very first render of a newly-added pin's photo, and the odd
  cache lookup for that URL, load a page you're not actually storing yet.
