# Infrastructure (Bicep)

Provisions everything the app needs on Azure: a Container Apps environment
running the FastAPI backend, Azure Database for PostgreSQL Flexible Server,
an Azure Container Registry, a Log Analytics workspace, and a Static Web
App for the built frontend.

```
infra/
  main.bicep                  # orchestrates the modules below (resource-group scope)
  main.parameters.json        # non-secret defaults; pass secrets via CLI/CI instead
  modules/
    log-analytics.bicep
    container-registry.bicep
    postgres.bicep
    container-apps-env.bicep
    container-app-backend.bicep   # includes the Easy Auth (Entra ID) authConfig
    static-web-app.bicep
```

Validated with the standalone Bicep CLI (`bicep build` / `bicep lint`) —
zero errors or warnings. Not yet deployed to a real subscription.

## One-time manual setup

These steps aren't automated by Bicep because they involve choices only a
human should make (subscription, resource group naming, secrets).

1. **Create a resource group**: `az group create -n rg-vacplanner-dev -l <region>`
2. **Register an Entra ID app for Easy Auth** (App registrations → New
   registration in the Azure portal, or `az ad app create`). This is what
   lets Azure Container Apps' built-in auth sign users in with Entra ID —
   see `backend/app/auth.py` for how the backend consumes it:
   - Redirect URI: `https://<your-container-app-fqdn>/.auth/login/aad/callback`
     (you'll know the fqdn only after the first deploy without auth — see
     step 4 — so this is a two-pass setup: deploy once with
     `entraClientId` empty, note the fqdn, register the app, redeploy with
     the real `entraClientId`/`entraClientSecret`/`entraTenantId`.)
   - Create a client secret under "Certificates & secrets".
   - Note the Application (client) ID, the secret value, and your tenant ID.
3. **Push a real backend image** to the registry this deployment creates
   (or let `.github/workflows/deploy.yml` do it) before the Container App
   will serve real traffic — `main.bicep`'s default image is a placeholder.
4. **Deploy**:
   ```
   az deployment group create \
     -g rg-vacplanner-dev \
     -f infra/main.bicep \
     -p infra/main.parameters.json \
     -p postgresAdminPassword='<a real secret>' \
     -p entraClientId='' # first pass: leave empty, deploy, note the backend fqdn
   ```
   Then re-run with `entraClientId`, `entraClientSecret`, and
   `entraTenantId` set once the app registration exists.

## Known simplifications (flagged for later hardening)

- **Postgres is publicly reachable** (with an "allow Azure services"
  firewall rule) rather than VNet-integrated with a private endpoint.
  Fine for a first deployment; tighten before real user data goes in.
- **ACR uses admin credentials**, not a managed identity pull. Simpler for
  a first CI/CD pass; switch the Container App to a user-assigned managed
  identity with `AcrPull` on the registry when ready.
- **SSE fan-out is in-memory and single-replica** (see
  `backend/app/events.py`). `maxReplicas: 3` in `container-app-backend.bicep`
  is fine for CPU/HTTP scaling today because nothing depends on which
  replica handles a request yet — but it does mean an SSE client can
  connect to a replica that never sees another replica's event. Before
  relying on live updates in production, either pin to `maxReplicas: 1` or
  move the event bus to something shared (Azure Web PubSub or Redis).
