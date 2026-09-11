# Deployment

How vacation-planner deploys to Azure.

## Architecture

Each environment: Azure Container Apps (FastAPI backend) + Azure Static
Web Apps (frontend) + Azure Database for PostgreSQL Flexible Server, via
Bicep. Full resource layout: `infra/README.md`. Database uses Entra ID
auth only — no Postgres password anywhere; see
`claude/db-privilege-provisioning.md` and infra/README.md's "Managed
identity database auth".

## Environments

Two fully separate environments (no shared resources):

| | dev | prod |
|---|---|---|
| GitHub Environment | `dev` | `prod` |
| Resource group | `rg-vacationplanner-dev` | `rg-vacationplanner` |
| Parameters file | `infra/main.parameters.dev.bicepparam` | `infra/main.parameters.prod.bicepparam` |
| Triggers on | every push to `main` | manual only |

Add a required reviewer on the `prod` GitHub Environment for a manual
approval gate.

## How to deploy

- **Dev**: push to `main` — `.github/workflows/deploy.yml` runs
  automatically.
- **Prod**: Actions tab → **Deploy** → **Run workflow** → `prod`.
- **Manually**: see `infra/README.md` "Deploy the infrastructure" for the
  equivalent `az` commands — useful for a first deploy of a new
  environment or debugging without CI.

`deploy.yml` jobs, in order: `infra` (Bicep), `backend` (`az acr build`,
points Container App at new image), `frontend` (`npm ci && npm run build`,
deploys `frontend/dist` to Static Web Apps).

## GitHub Environment variables & secrets

Set on both `dev` and `prod`, each pointing at that environment's own
resources.

### Variables (not secret)

| Name | Value / how to get it |
|---|---|
| `DEPLOY_CLIENT_ID` | Client ID of that environment's federated Entra app registration (`gh-vacationplanner-dev-deploy` / `...-prod-deploy`) — `infra/README.md` step 2. |
| `AZURE_SUBSCRIPTION_ID` | `az account show --query id -o tsv` |
| `AZURE_TENANT_ID` | `az account show --query tenantId -o tsv` |
| `AZURE_RESOURCE_GROUP` | `rg-vacationplanner-dev` (dev) / `rg-vacationplanner` (prod) |
| `ACR_NAME` | `vacationplannerdev` (dev) / `vacationplanner` (prod) |
| `CONTAINER_APP_NAME` | `vacationplanner-dev` (dev) / `vacationplanner` (prod) |
| `EASY_AUTH_CLIENT_ID` | Client ID of the separate Easy Auth Entra app registration (`infra/README.md` step 3). Leave unset until Easy Auth is set up. |

No `POSTGRES_ADMIN_*` variable — the Postgres Entra admin is a manual
per-environment step (`infra/README.md` "One-time manual setup" step 6).

### Secrets (sensitive)

| Name | Value / how to get it |
|---|---|
| `EASY_AUTH_CLIENT_SECRET` | From the Easy Auth app registration. Leave unset until Easy Auth is set up. |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Deployment token from the Static Web App resource — only exists after the first Bicep deploy, filled in on a second pass. |

### Not needed at all

No stored Azure credential — login is federated (OIDC) via
`DEPLOY_CLIENT_ID`. No Postgres password/connection-string secret either
— Entra-ID-auth-only database.

## One-time setup (per environment, before CI deploy works)

1. **Resource group** created (`rg-vacationplanner-dev` / `rg-vacationplanner`).
2. **Federated credential** on that environment's Entra app trusting
   `repo:itchy-squid/vacation-planner:environment:dev` (or `:prod`) —
   `infra/README.md` "Continuous deployment" step 2.
3. **`infra/sql/provision_roles.sql`** run once by hand against that
   environment's Postgres server — `infra/README.md` step 6.
4. **Prod**: consider the required-reviewer approval gate above.

## First deploy of a new environment

Two-pass, since `entraClientId`/`EASY_AUTH_CLIENT_ID` and
`AZURE_STATIC_WEB_APPS_API_TOKEN` aren't known until after a first partial
deploy:

1. Set the Variables above, `EASY_AUTH_CLIENT_ID` empty.
2. Run the workflow (or `infra/README.md` step 5's manual
   `-p entraClientId=''` pass). `infra` job deploys with no Easy Auth and
   the Container App gets a backend FQDN.
3. Register the Easy Auth Entra app using that FQDN as redirect URI
   (`infra/README.md` step 3), then set `EASY_AUTH_CLIENT_ID` and
   `EASY_AUTH_CLIENT_SECRET`.
4. After that deploy, grab the Static Web App's deployment token from the
   portal and set `AZURE_STATIC_WEB_APPS_API_TOKEN`.
5. Re-run the workflow.
6. Provision database roles and run the first migration —
   `infra/README.md` steps 6–7 (manual, not part of `deploy.yml`).

## Known simplifications (flagged for later hardening)

From `infra/README.md`:

- Postgres is publicly reachable ("allow Azure services" firewall rule),
  not VNet-integrated. Narrow later.
- ACR uses admin credentials, not managed-identity pull. Switch the
  Container App to its existing user-assigned identity with `AcrPull`
  when ready.
- SSE fan-out is in-memory, single-replica (`backend/app/events.py`).
  Fine at `maxReplicas: 3` today; pin to `maxReplicas: 1` or move to a
  shared event bus (Azure Web PubSub or Redis) before relying on live
  updates in production.

## Reference

- `.github/workflows/deploy.yml` — the pipeline itself.
- `infra/README.md` — full infra walkthrough.
- `claude/db-privilege-provisioning.md` (project docs) — database
  auth/privilege model rationale.
