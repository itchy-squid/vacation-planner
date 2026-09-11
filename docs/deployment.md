# Deployment

How vacation-planner gets deployed to Azure, and everything you need to
set up or troubleshoot that pipeline.

## Architecture

Each environment runs on Azure Container Apps (FastAPI backend) + Azure
Static Web Apps (built frontend) + Azure Database for PostgreSQL Flexible
Server, provisioned by Bicep. Full resource layout: `infra/README.md`.
The database uses Microsoft Entra ID (Azure AD) auth only — no Postgres
password exists anywhere, for anyone or anything; see
`claude/db-privilege-provisioning.md` for why, and `infra/README.md`
"Managed identity database auth" for how.

## Environments

Two independent environments, entirely separate resources (resource
group, registry, Postgres server, Static Web App — nothing shared):

| | dev | prod |
|---|---|---|
| GitHub Environment | `dev` | `prod` |
| Resource group | `rg-vacationplanner-dev` | `rg-vacationplanner` |
| Parameters file | `infra/main.parameters.json` | `infra/main.parameters.prod.json` |
| Triggers on | every push to `main` | manual only |

There's no branch that auto-deploys prod, so a prod release is always a
deliberate, one-off action. Add a required reviewer on the `prod` GitHub
Environment (Settings → Environments → prod) if you want a manual approval
gate before anything actually deploys there.

## How to deploy

- **Dev**: push to `main`. `.github/workflows/deploy.yml` runs
  automatically.
- **Prod**: Actions tab → **Deploy** → **Run workflow** → pick `prod` from
  the environment dropdown.
- **Manually, from your machine**: see `infra/README.md` "Deploy the
  infrastructure" for the equivalent `az deployment group create` /
  `az acr build` / `az containerapp update` commands. Useful for the very
  first deploy of a new environment (see "First deploy of a new
  environment" below) or when debugging without waiting on CI.

`deploy.yml` has three jobs, in order: `infra` (Bicep — Container Apps
env, Postgres, ACR, Static Web App, Easy Auth config), `backend` (builds
the image with `az acr build`, points the Container App at it), `frontend`
(`npm ci && npm run build`, deploys `frontend/dist` to Static Web Apps).

## GitHub Environment variables & secrets

Every value below is set **twice** — once on the `dev` GitHub Environment,
once on `prod` — pointing at that environment's own Azure resources.
(Settings → Environments → dev/prod → Variables tab / Secrets tab.)

### Variables (not secret)

| Name | Value / how to get it |
|---|---|
| `DEPLOY_CLIENT_ID` | Application (client) ID of that environment's federated Entra app registration (`gh-vacationplanner-dev-deploy` / `...-prod-deploy`). Created in `infra/README.md` step 2. |
| `AZURE_SUBSCRIPTION_ID` | `az account show --query id -o tsv` |
| `AZURE_TENANT_ID` | `az account show --query tenantId -o tsv` — one tenant covers GitHub login, Postgres AAD admin, and Easy Auth, so this is the same value for both environments. |
| `AZURE_RESOURCE_GROUP` | `rg-vacationplanner-dev` (dev) / `rg-vacationplanner` (prod) |
| `ACR_NAME` | `vacationplannerdev` (dev) / `vacationplanner` (prod) |
| `CONTAINER_APP_NAME` | `vacationplanner-dev` (dev) / `vacationplanner` (prod) |
| `POSTGRES_ADMIN_OBJECT_ID` | Your Entra object ID: `az ad signed-in-user show --query id -o tsv` |
| `POSTGRES_ADMIN_PRINCIPAL_NAME` | Your Entra UPN/email |
| `EASY_AUTH_CLIENT_ID` | Application (client) ID of the **separate** Easy Auth Entra app registration (`infra/README.md` step 3). Leave unset until Easy Auth is set up — the deploy still works without it. |

### Secrets (sensitive)

| Name | Value / how to get it |
|---|---|
| `EASY_AUTH_CLIENT_SECRET` | Client secret value from the Easy Auth app registration ("Certificates & secrets"). Leave unset until Easy Auth is set up. |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Deployment token from the Static Web App resource — only exists after the *first* Bicep deploy creates it, so this one is filled in on a second pass. |

`GITHUB_TOKEN` (used by the frontend job) is provided automatically by
GitHub Actions — nothing to set.

### Not needed at all

Azure login (`azure/login@v2`) is OIDC/federated — there is **no** Azure
client secret, service principal password, or `AZURE_CREDENTIALS` JSON
blob to store anywhere. That's the point of `DEPLOY_CLIENT_ID` + the
federated credential below. Likewise there is no Postgres
password/connection-string secret — the database is Entra-ID-auth-only.

## One-time setup (per environment, before the first CI deploy works)

None of this is GitHub config, but the pipeline won't produce a working
deploy without it:

1. **Resource group** created (`rg-vacationplanner-dev` / `rg-vacationplanner`).
2. **Federated credential** on that environment's Entra app trusting
   `repo:itchy-squid/vacation-planner:environment:dev` (or `:prod`) — this
   is what lets GitHub Actions authenticate to Azure with no stored
   credential at all. Exact `az` commands and a no-CLI Entra-admin-center
   path: `infra/README.md` "Continuous deployment", step 2.
3. **`infra/sql/provision_roles.sql`** run once by hand against that
   environment's Postgres server — a database-level operation the
   pipeline doesn't (and can't) run itself. `infra/README.md` step 6.
4. For **prod** specifically: consider the required-reviewer approval
   gate mentioned above.

## First deploy of a new environment

`entraClientId`/`EASY_AUTH_CLIENT_ID` and
`AZURE_STATIC_WEB_APPS_API_TOKEN` can't be known until after a first
partial deploy, so bringing up a brand-new environment is a two-pass
process:

1. Set the **Variables** above, leaving `EASY_AUTH_CLIENT_ID` empty.
2. Run the workflow (or the manual `az deployment group create` /
   `-p entraClientId=''` first pass in `infra/README.md` step 5). The
   `infra` job deploys with no Easy Auth configured and the Container App
   gets a backend FQDN — check that job's output or the Azure portal.
3. Register the Easy Auth Entra app using that FQDN as the redirect URI
   (`infra/README.md` step 3), then set `EASY_AUTH_CLIENT_ID` (Variables)
   and `EASY_AUTH_CLIENT_SECRET` (Secrets).
4. After that first deploy, the Static Web App resource exists — grab its
   deployment token from the Azure portal and set
   `AZURE_STATIC_WEB_APPS_API_TOKEN` (Secrets).
5. Re-run the workflow. Everything should now be fully wired.
6. Provision database roles and run the first migration against the new
   server — `infra/README.md` steps 6–7 (not part of `deploy.yml`; done
   by hand, once, per environment).

## Known simplifications (flagged for later hardening)

From `infra/README.md`:

- **Postgres is publicly reachable** (with an "allow Azure services"
  firewall rule) rather than VNet-integrated with a private endpoint. No
  password exists to leak either way, but network exposure is still worth
  narrowing later.
- **ACR uses admin credentials**, not a managed identity pull. Switch the
  Container App to use its existing user-assigned managed identity with
  `AcrPull` on the registry when ready.
- **SSE fan-out is in-memory and single-replica** (`backend/app/events.py`).
  Fine at `maxReplicas: 3` for CPU/HTTP scaling today since nothing
  depends on which replica handles a request yet, but an SSE client can
  connect to a replica that never sees another replica's event. Pin to
  `maxReplicas: 1` or move the event bus to something shared (Azure Web
  PubSub or Redis) before relying on live updates in production.

## Reference

- `.github/workflows/deploy.yml` — the pipeline itself (heavily commented).
- `infra/README.md` — full infra walkthrough: resource layout, exact `az`
  commands for manual deploys, OIDC setup (CLI and Entra-admin-center
  paths), database role provisioning, connecting as a maintainer, adding a
  maintainer later.
- `claude/db-privilege-provisioning.md` (project docs) — why the database
  auth/privilege model is shaped the way it is.
