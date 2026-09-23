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
   - Optional: Google sign-in as well (or instead) -- see "Set up Google
     sign-in" below. Either provider alone is enough to turn Easy Auth on.

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
   unset ENTRA_CLIENT_ID ENTRA_CLIENT_SECRET EASY_AUTH_GOOGLE_CLIENT_ID EASY_AUTH_GOOGLE_CLIENT_SECRET
   az deployment group create \
     -g vacationplanner-dev \
     -p infra/main.parameters.dev.bicepparam
   ```
   note the backend fqdn. prod:
   ```
   unset ENTRA_CLIENT_ID ENTRA_CLIENT_SECRET EASY_AUTH_GOOGLE_CLIENT_ID EASY_AUTH_GOOGLE_CLIENT_SECRET
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
   export EASY_AUTH_GOOGLE_CLIENT_ID='...'   # optional, see "Set up Google sign-in"
   export EASY_AUTH_GOOGLE_CLIENT_SECRET='...'
   az deployment group create -g vacationplanner-dev -p infra/main.parameters.dev.bicepparam
   ```
   Note the `backendIdentityObjectId` and `postgresFqdn` outputs. Repeat
   steps 2, 3, 6, 7, 8, 9 independently per environment.

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

7. **Grant the backend identity storage roles** — like the Postgres Entra
   Administrator above, this is a manual step: the GitHub Actions deploy
   identity only holds Contributor on the resource group ("Continuous
   deployment" below), and built-in Contributor explicitly excludes
   `Microsoft.Authorization/*/Write`, so CI can create the storage account
   and its container but can't grant roles on it
   (`infra/modules/storage-account.bicep`). Run once per environment,
   using the `backendIdentityObjectId` and `photoStorageAccountName`
   outputs from step 5:
   ```
   STORAGE_ID=$(az storage account show \
     -g vacationplanner-dev -n <photoStorageAccountName from step 5> \
     --query id -o tsv)

   az role assignment create \
     --assignee-object-id <backendIdentityObjectId from step 5> \
     --assignee-principal-type ServicePrincipal \
     --role "Storage Blob Data Contributor" \
     --scope "$STORAGE_ID"

   az role assignment create \
     --assignee-object-id <backendIdentityObjectId from step 5> \
     --assignee-principal-type ServicePrincipal \
     --role "Storage Blob Delegator" \
     --scope "$STORAGE_ID"
   ```
   (prod: `-g vacationplanner`.) Without this, the storage account and
   container still get created fine, but every actual blob read/write and
   SAS-URL mint (`backend/app/photo_storage.py`) fails with an
   authorization error at runtime.

8. **Provision the database roles** — connect as yourself (already the
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

9. **Run the migration** — no manual command anymore. Nothing (not the
   app, not a maintainer) runs `alembic upgrade head` by hand; it runs in
   CI, connected as `gh-deploy`, in `.github/workflows/deploy.yml`'s
   `migrate` job — see "Continuous deployment" below. Once step 8 above
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

Once set up: every PR opened or updated against `main` deploys its
branch to dev, and every merge (push) to `main` deploys prod (paused for
approval if a required reviewer is set). Actions tab → "Deploy" → "Run
workflow" deploys either one on demand.

## Custom domains

The frontend gets a custom domain via `frontendCustomDomainName`
(`infra/main.bicep`) -- two-pass, same shape as Easy Auth: deploy with the
param empty to learn the auto-generated hostname, point DNS at it,
redeploy with the param set. Static Web Apps binds it in one step with no
certificate complications.

The backend's custom domain and certificate are **not managed by this
template** -- `modules/container-app-backend.bicep` has no
`bindCustomDomain` / certificate parameters, and never touches ingress's
`customDomains` or any managed certificate resource. Binding one is a
manual, one-time step per environment, done directly against the deployed
Container App -- the same shape as the Postgres AAD Administrator and
storage role assignments above:

1. Deploy with `backendCustomDomainName` empty (the default). Note the
   `backendUrl` output -- the auto-generated `*.azurecontainerapps.io`
   hostname, since nothing has told the template about a custom domain
   yet. `deploy.yml` builds the frontend against whatever `backendUrl`
   currently is, so it targets this auto-generated hostname for now.
2. Get the verification ID Azure needs before it will accept a custom
   domain for this app:
   ```bash
   az containerapp show -g <resource-group> -n <app-name> --query properties.customDomainVerificationId -o tsv
   ```
3. DNS records at whichever provider hosts `amandasanti.com` (dev example
   shown; drop `.dev` for prod):

   | Record | Host | Value |
   |---|---|---|
   | CNAME | `vacations-api.dev` | the `backendUrl` output's hostname (strip `https://`) |
   | TXT | `asuid.vacations-api.dev` | the verification ID from step 2 |

4. Wait for DNS to resolve (`dig CNAME vacations-api.dev.amandasanti.com`,
   `dig TXT asuid.vacations-api.dev.amandasanti.com`), then bind it:
   ```bash
   az containerapp hostname add --hostname vacations-api.dev.amandasanti.com -g <resource-group> -n <app-name>
   az containerapp hostname bind --hostname vacations-api.dev.amandasanti.com -g <resource-group> -n <app-name> --environment <env-name>
   ```
   (`<resource-group>`, `<app-name>` and `<env-name>` are all
   `vacationplanner-dev` for dev, all `vacationplanner` for prod -- see
   the `suffix` variable in `main.bicep`.) `hostname bind` creates and
   binds a managed certificate in one step, under Azure's own
   auto-generated certificate name.
5. **Set `backendCustomDomainName` to that same hostname and redeploy.**
   Also set `backendCertificateName` (see "Redeploys keep the binding"
   below). `backendCustomDomainName` moves `backendUrl` (and therefore what the
   frontend build targets, and what Easy Auth's sign-in redirect will be
   built against) onto the now-bound custom domain instead of the
   auto-generated one. Also update the Entra app registration's
   redirect URI to match this hostname
   (`https://<hostname>/.auth/login/aad/callback`) if it doesn't already
   -- a mismatch here is what produces Microsoft's
   `invalid_request: ... redirect_uri ...` error at sign-in.

Azure auto-renews managed certificates in place (same resource, refreshed
automatically ahead of expiry), so steps 1-4 are a genuine one-time step
per environment, not a recurring one. Step 5 only needs repeating if the
hostname itself ever changes.

**Redeploys keep the binding.** ARM's PUT replaces the Container App's
whole `configuration.ingress`, so a template that simply omits
`customDomains` unbinds the domain on every deploy. So in step 5, also set
`backendCertificateName` to the managed certificate `hostname bind`
created (`az containerapp env certificate list -g <resource-group> -n
<env-name> --managed-certificates-only`). With both set, `main.bicep`
references that certificate as an `existing` resource and restates the
binding on every deploy. With either empty, no binding is declared, so a
brand-new environment's first deploy can't fail on it.

**Why this isn't in Bicep:** it used to be, until prod's first deploy hit
a chicken-and-egg failure (`CertificateNotFound` +
`RequireCustomHostnameInEnvironment`) that dev's setup had never actually
exercised end-to-end -- dev's certificate was created via `az
containerapp hostname bind` from the start, and Bicep was only ever
pointed at it afterwards via `existingCertificateResourceId`. The
template could only express "no custom domain" or "fully SNI-bound with a
certificate," never the intermediate "hostname registered, no certificate
yet" state Azure actually requires before it will issue one for the
backend, and even fixing that gap would leave Bicep trying to own the
lifecycle of a resource Azure already manages and renews on its own.
Letting the CLI be the one source of truth for the binding avoids that
fight entirely.

`corsOrigins` feeds the Container App ingress's own `corsPolicy`
(`modules/container-app-backend.bicep`) -- the only place CORS is
configured; the app itself (`backend/app/main.py`) runs no CORS
middleware, and local dev avoids the question entirely via the Vite dev
server's proxy (`frontend/vite.config.js`). It's set to the frontend's
custom domain (e.g. `https://vacations.dev.amandasanti.com` for dev) --
if you're testing against the backend's auto-generated hostname before
binding its custom domain, that origin may need to be added to
`corsOrigins` temporarily too.

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
  The backend is pinned to `minReplicas: 0` / `maxReplicas: 1` to
  minimize cost, which also keeps SSE correct (one replica sees every
  event). With more than one replica an SSE client could connect to a
  replica that never sees another replica's event, so move to a shared
  event bus (Azure Web PubSub or Redis) before raising `maxReplicas`.
  Trade-off of `minReplicas: 0`: the first request after an idle period
  pays a cold start (container pull + app boot), and open SSE
  connections keep the replica alive while they're connected.
  Easy Auth runs inside the replica, so even a sign-in redirect waits
  out that cold start; the frontend shows a "waking up the server"
  screen meanwhile (`frontend/src/pages/BootScreen.jsx`) and retries
  the session check through platform 502/503/504s. Setting
  `minReplicas: 1` removes the wait at the cost of an always-on (idle-
  rate) replica.
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

## Set up Google sign-in

Optional, per environment. Easy Auth's Google provider sits alongside the
Entra one (`modules/container-app-backend.bicep`); each is turned on only
when its client ID is supplied.

1. In [console.cloud.google.com](https://console.cloud.google.com), create
   (or pick) a project. No billing account or APIs are needed.
2. **Google Auth Platform** (APIs & Services -> OAuth consent screen):
   External audience; app name and support email; add `amandasanti.com`
   under Branding -> Authorized domains. While the app is in Testing,
   only the listed test users can sign in -- publish it to open sign-in to
   any Google account (the default openid/email/profile scopes need no
   verification).
3. **Clients -> Create client -> Web application**, with the authorized
   redirect URI `https://<backend host>/.auth/login/google/callback`
   (`vacations-api.dev.amandasanti.com` / `vacations-api.amandasanti.com`).
   No JavaScript origins -- Easy Auth runs the flow server-side.
4. Copy the client ID and secret. Set them as `EASY_AUTH_GOOGLE_CLIENT_ID`
   (variable) and `EASY_AUTH_GOOGLE_CLIENT_SECRET` (secret) on the GitHub
   environment, or as the same-named env vars for a manual deploy (step 5).

Users are keyed by email (`backend/app/auth.py`), so someone who signs in
with Google and with a Microsoft account under the same address is the
same contributor. The backend rejects Google sign-ins whose email Google
hasn't verified. The frontend offers a button per configured provider
(`VITE_AUTH_PROVIDERS`, set by the deploy workflow) and remembers the last
one used, so an expired session goes straight back to it.
