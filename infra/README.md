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
| Container Registry (alphanumeric only) | `vacationplannerdev` | `vacationplanner` |
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
   for later steps. Repeat steps 2, 3, 6, 7, and 8 independently for each
   environment — dev and prod each get their own Entra app registration,
   Postgres roles, and migration run, since they're entirely separate
   resources.

6. **Create the Postgres Microsoft Entra Administrator manually** —
   Bicep's own `Microsoft.DBforPostgreSQL/flexibleServers/administrators`
   resource reliably fails with an opaque `InternalServerError` (no
   further detail) when created as part of this deployment. This is a
   known, unresolved issue on Azure's side — see Microsoft's own Q&A
   threads on this exact resource type — not something wrong in this
   template, so `infra/main.bicep` no longer tries to provision it.
   Create it by hand instead, against the server the previous step just
   created, using the object ID / display name from step 2:
   ```
   az postgres flexible-server ad-admin create \
     -g rg-vacationplanner-dev \
     -s vacationplanner-dev \
     -i <postgresAadAdminObjectId from step 2> \
     -u <postgresAadAdminPrincipalName from step 2> \
     -t User
   ```
   (for prod: `-g rg-vacationplanner -s vacationplanner` instead). This is
   the one Postgres role Azure provisions for you with no SQL required —
   see "Managed identity database auth" above for what it's for.

7. **Provision the database roles** — connect to the new server as
   yourself (you're already its Entra Administrator, from step 6) and run
   `infra/sql/provision_roles.sql`, filling in your own object ID and the
   `backendIdentityObjectId` output where the script asks for them:
   ```
   PGPASSWORD="$(az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)" \
     psql "host=<postgresFqdn output> dbname=vacation_planner user=<your-email> sslmode=require" \
     -f infra/sql/provision_roles.sql
   ```
   (Access tokens are short-lived — if `psql` reports an auth failure,
   just re-run the `az account get-access-token` part and retry.)

8. **Run the migration** against the now-provisioned database — same
   connection approach as step 7, but pointed at the backend:
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
   own copies of the values below, so dev and prod never share one. Point
   dev's copies at the `rg-vacationplanner-dev` resources and prod's at
   the `rg-vacationplanner` ones from the steps above.
2. **Set up federated (OIDC) auth for GitHub → Azure**, once per
   environment — this is how the workflow authenticates to Azure with no
   stored credential at all (not a client secret, not a service principal
   password — the trust is the federated credential itself, verified
   directly against the GitHub Actions OIDC token):

   **A prerequisite that changed recently:** GitHub has rolled out
   ["immutable subject claims"](https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/)
   for Actions OIDC tokens. The token's `sub` claim can now embed the
   *numeric* owner and repository IDs —
   `repo:<owner>@<owner_id>/<repo>@<repo_id>:environment:<env>` — instead
   of just the owner/repo *names*, so a federated credential can't be
   silently inherited by someone else's repo after a rename or transfer.
   This repo's IDs, for when you need them below:
   - Owner (`itchy-squid`) ID: `86495347`
   - Repository (`vacation-planner`) ID: `1358795740`

   Whether GitHub actually mints tokens in the new format depends on
   whether this repo (or its org) has opted in — **existing repos don't
   get switched over automatically**; only repos *created* on or after
   July 15, 2026 do. Opt-in today is per-repo or per-org, via the OIDC
   settings UI (repo or org Settings → Actions → General, in the OIDC
   section) or the REST API — GitHub hasn't pinned down an exact toggle
   label in its docs, but there's also a preview endpoint that shows you
   the *exact* subject string a token would carry, which is worth using
   here: a mismatch between what you configure in Azure and what GitHub
   actually issues fails silently, with Azure just rejecting the token
   and no hint that the subject *format* (not just the value) is the
   problem. **Until you've confirmed the opt-in is on, use the old
   name-based subject below
   (`repo:itchy-squid/vacation-planner:environment:$ENV`) instead of the
   ID-based one** — it still works for any repo that hasn't opted in,
   including this one today.
   ```
   ENV=dev   # then repeat the whole block with ENV=prod
   RG=rg-vacationplanner-dev   # rg-vacationplanner for the prod pass

   # An app registration + service principal used only for this
   # environment's deploys — kept separate from prod's, same reasoning as
   # every other per-environment resource in this file.
   APP_ID=$(az ad app create --display-name "gh-vacationplanner-$ENV-deploy" --query appId -o tsv)
   az ad sp create --id "$APP_ID"

   # Scope it to just that environment's resource group.
   az role assignment create \
     --assignee "$APP_ID" \
     --role Contributor \
     --scope "/subscriptions/<subscription-id>/resourceGroups/$RG"

   # Trust GitHub Actions runs against this repo's "$ENV" GitHub
   # Environment specifically (not just any run on any branch). Pick
   # whichever "subject" line below matches whether this repo has opted
   # into immutable subject claims (see above) — not both at once.
   az ad app federated-credential create --id "$APP_ID" --parameters '{
     "name": "github-actions-'"$ENV"'",
     "issuer": "https://token.actions.githubusercontent.com",
     "subject": "repo:itchy-squid/vacation-planner:environment:'"$ENV"'",
     "audiences": ["api://AzureADTokenExchange"]
   }'
   # — once immutable subject claims are confirmed opted-in for this
   #   repo, use this "subject" instead of the name-based one above:
   #   "subject": "repo:itchy-squid@86495347/vacation-planner@1358795740:environment:'"$ENV"'",

   echo "DEPLOY_CLIENT_ID ($ENV) = $APP_ID"
   ```
   The `subject` is what makes this safe to scope per-environment: Azure
   AD only accepts the token if it was minted for a run against that exact
   GitHub Environment, so prod's app registration can't be used by a run
   targeting dev, or vice versa.

   **Doing this by hand instead, via the Microsoft Entra admin center**
   (no CLI) — repeat this whole sequence once for `dev` and once for
   `prod`. The same immutable-subject caveat above still applies, with one
   extra wrinkle: **the portal wizard only ever produces the old
   name-based subject** — there's no field in it for the ID-based one. If
   this repo has opted into immutable subject claims, use the CLI block
   above instead of this walkthrough for the federated-credential step
   (the ID-based `subject` is only settable through the CLI/API JSON
   payload today, not the portal UI):
   1. [entra.microsoft.com](https://entra.microsoft.com) → **Identity** →
      **Applications** → **App registrations** → **+ New registration**.
      Name it `gh-vacationplanner-dev-deploy` (or `...-prod-deploy`),
      leave "Accounts in this organizational directory only" selected,
      leave the redirect URI blank, and **Register**. This creates both
      the app registration and its backing service principal in one step
      — unlike the CLI path, there's no separate "create the service
      principal" action to remember here.
   2. On the new app's **Overview** page, copy the **Application (client)
      ID** — that's this environment's `DEPLOY_CLIENT_ID` — and the
      **Directory (tenant) ID**, which is `AZURE_TENANT_ID` (the same
      value both times, since there's only one tenant; you only need to
      copy it once).
   3. **Certificates & secrets** → **Federated credentials** tab → **+
      Add credential**. Under "Federated credential scenario" pick
      **"GitHub Actions deploying Azure resources"**, then fill in:
      - Organization: `itchy-squid`
      - Repository: `vacation-planner`
      - Entity type: **Environment**
      - GitHub environment name: `dev` (or `prod`)
      - Name: `github-actions-dev` (or `github-actions-prod`)

      Issuer and audience auto-fill to
      `https://token.actions.githubusercontent.com` and
      `api://AzureADTokenExchange` — leave those as they are. Select
      **Add**. The subject this produces is the old name-based
      `repo:itchy-squid/vacation-planner:environment:dev` string — fine
      as long as this repo hasn't opted into immutable subject claims
      (see above); if it has, skip this step and add the credential via
      the CLI block instead.
   4. Switch to the [Azure portal](https://portal.azure.com) →
      **Resource groups** → `rg-vacationplanner-dev` (or
      `rg-vacationplanner`) → **Access control (IAM)** → **+ Add** →
      **Add role assignment** → role **Contributor** → **+ Select
      members** → search for `gh-vacationplanner-dev-deploy` (or the
      `-prod-deploy` one) → **Review + assign**. This is what scopes the
      app registration to just that environment's resource group, the
      same as the CLI's `az role assignment create`.
   5. For `AZURE_SUBSCRIPTION_ID`: Azure portal → **Subscriptions** →
      copy the **Subscription ID** shown there (same value for both
      environments if they share a subscription).
3. **Set the environment's variables and secrets**, using the values
   above:
   - **Variables** (that environment's "Variables" tab — none of these
     are secret, they're just per-environment config that happens to live
     next to the secrets below): `DEPLOY_CLIENT_ID` (the `$APP_ID` from
     step 2), `AZURE_SUBSCRIPTION_ID` (`az account show --query id -o tsv`),
     `AZURE_TENANT_ID` (`az account show --query tenantId -o tsv`) —
     there's only one Entra tenant involved here, so this single value
     covers GitHub's federated login, Postgres's AAD admin, and Easy Auth
     alike, rather than needing a separate tenant ID per consumer —
     `AZURE_RESOURCE_GROUP`, `ACR_NAME`, `CONTAINER_APP_NAME`,
     `POSTGRES_ADMIN_OBJECT_ID`, `POSTGRES_ADMIN_PRINCIPAL_NAME`,
     and the optional `EASY_AUTH_CLIENT_ID` (a distinct Entra app from the
     `DEPLOY_CLIENT_ID` one above — different client IDs, same tenant).
   - **Secrets** (that environment's "Secrets" tab — these genuinely are
     sensitive, and are the *only* things that belong there now that
     Azure login is federated): the optional `EASY_AUTH_CLIENT_SECRET`, and
     `AZURE_STATIC_WEB_APPS_API_TOKEN` (from the Static Web App resource,
     after the first Bicep deploy creates it).
4. **Optionally add a required reviewer** on the `prod` environment
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
