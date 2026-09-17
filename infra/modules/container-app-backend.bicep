@description('''The FastAPI/uvicorn backend as an Azure Container App, with
Easy Auth (Entra ID) in front of it for user sign-in, and a user-assigned
managed identity for passwordless database access (see
infra/README.md "Managed identity database auth" and app/db.py
install_azure_ad_token_provider). These are two independent uses of Entra
ID — Easy Auth authenticates the human hitting the API; the managed
identity authenticates the container to Postgres — and neither depends on
the other.''')
param location string
param name string
param containerAppsEnvironmentId string
param containerImage string
param registryLoginServer string
param registryUsername string
@secure()
param registryPassword string
param corsOrigins string

@description('''Informational only -- NOT applied to ingress and does not
create or reference any certificate. This template never manages the
backend's custom domain or TLS certificate (see infra/README.md "Custom
domains" for why: Azure auto-renews managed certificates in place, and
letting this template also model that lifecycle created an ongoing
source-of-truth conflict). Once a custom domain has been bound out-of-band
via `az containerapp hostname add` / `hostname bind`, set this to that
same hostname so this module's `url` output -- which the frontend build
reads as its API base URL, and which Easy Auth's sign-in redirect must
match -- reflects the domain that's actually publicly reachable, rather
than the auto-generated fqdn nothing but this template still uses. Leave
empty until the domain is actually bound.''')
param customDomainName string = ''

@description('Resource ID of the user-assigned managed identity (infra/modules/managed-identity.bicep) to attach to this Container App.')
param managedIdentityId string
@description('Client ID of that same managed identity — read back by the app as AZURE_CLIENT_ID so DefaultAzureCredential targets this identity specifically.')
param managedIdentityClientId string

@description('Fully qualified domain name of the Postgres Flexible Server.')
param postgresHost string
param postgresDatabase string = 'vacation_planner'
@description('''The Postgres role name mapped to this Container App's
managed identity (see infra/sql/provision_roles.sql) — used as the
connection username. Not a secret: on an AAD-auth-only server, knowing this
name grants nothing without also being (or impersonating) the identity
itself.''')
param postgresAppRole string = 'app-backend'

@description('Blob endpoint of the storage account pin photos are mirrored into (modules/storage-account.bicep\'s blobEndpoint output) -- read back by the app as AZURE_STORAGE_ACCOUNT_URL (see app/config.py, app/photo_storage.py).')
param storageBlobEndpoint string
param storageContainerName string = 'pin-photos'

@description('Set to enable Azure Easy Auth with Entra ID. Leave clientId empty to deploy without auth turned on yet (see infra/README.md).')
param entraClientId string = ''
@secure()
param entraClientSecret string = ''

@description('Set to enable Google sign-in through Easy Auth, alongside or instead of Entra ID. Leave empty to leave Google off (see infra/README.md "Set up Google sign-in").')
param googleClientId string = ''
@secure()
param googleClientSecret string = ''

var entraEnabled = !empty(entraClientId)
var googleEnabled = !empty(googleClientId)
// Easy Auth is on as soon as either provider is configured.
var authEnabled = entraEnabled || googleEnabled

// Single source of truth for CORS: enforced entirely at the Container
// Apps ingress (below), not in application code -- see
// backend/app/main.py, which no longer runs its own CORSMiddleware.
// Local dev sidesteps CORS altogether via the Vite dev server's proxy
// (frontend/vite.config.js) rather than needing a second policy here.
var corsOriginList = [for origin in split(corsOrigins, ','): trim(origin)]

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironmentId
    configuration: {
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto'
        corsPolicy: {
          allowedOrigins: corsOriginList
          allowedMethods: ['*']
          allowedHeaders: ['*']
          allowCredentials: true
        }
        // No customDomains entry: this template no longer manages the
        // backend's custom domain or its managed certificate -- Azure
        // auto-renews managed certs in place, and a fixed hostname/cert
        // binding managed out-of-band survives redeploys of everything
        // else here. See infra/README.md "Custom domains" for the
        // one-time `az containerapp hostname add` / `hostname bind` step
        // per environment.
      }
      registries: [
        {
          server: registryLoginServer
          username: registryUsername
          passwordSecretRef: 'registry-password'
        }
      ]
      secrets: concat(
        [
          { name: 'registry-password', value: registryPassword }
        ],
        entraEnabled ? [{ name: 'entra-client-secret', value: entraClientSecret }] : [],
        googleEnabled ? [{ name: 'google-client-secret', value: googleClientSecret }] : []
      )
    }
    template: {
      containers: [
        {
          name: 'backend'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            // No password anywhere: DATABASE_URL carries only host/db/role/
            // sslmode, USE_AZURE_AD_AUTH tells app/db.py to fetch a fresh
            // Entra token per connection instead, and AZURE_CLIENT_ID tells
            // DefaultAzureCredential which of this Container App's
            // (potentially several) identities to use — see
            // app/db.py and app/config.py.
            { name: 'DATABASE_URL', value: 'postgresql+psycopg://${postgresAppRole}@${postgresHost}:5432/${postgresDatabase}?sslmode=require' }
            { name: 'USE_AZURE_AD_AUTH', value: 'true' }
            { name: 'AZURE_CLIENT_ID', value: managedIdentityClientId }
            { name: 'ENVIRONMENT', value: 'production' }
            // Same managed identity as the two vars above, reused for
            // blob storage (see app/photo_storage.py) -- one identity,
            // two Azure services, no stored credential for either.
            { name: 'AZURE_STORAGE_ACCOUNT_URL', value: storageBlobEndpoint }
            { name: 'AZURE_STORAGE_CONTAINER', value: storageContainerName }
            // Where app/routers/spa_redirect.py sends non-API navigations
            // (e.g. Easy Auth's /.auth/login/done "Return to website"
            // button). The first CORS origin is the SPA by convention.
            { name: 'FRONTEND_URL', value: corsOriginList[0] == '*' ? '' : corsOriginList[0] }
          ]
          probes: [
            {
              type: 'Readiness'
              httpGet: { path: '/healthz', port: 8000 }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
            {
              type: 'Liveness'
              httpGet: { path: '/healthz', port: 8000 }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

// Easy Auth: Azure Container Apps' built-in authentication, terminating the
// Entra ID and/or Google sign-in at the platform edge and forwarding the
// signed-in user to the app via X-MS-CLIENT-PRINCIPAL* headers — see
// backend/app/auth.py. Only created once at least one provider's client ID
// is supplied; until then the Container App deploys without auth turned on. See
// infra/README.md for the app-registration steps (manual, one-time).
resource authConfig 'Microsoft.App/containerApps/authConfigs@2024-03-01' = if (authEnabled) {
  parent: containerApp
  name: 'current'
  properties: {
    platform: { enabled: true }
    // The SPA lives on a different host than this API (vacations.<env>
    // .amandasanti.com vs vacations-api.<env>.amandasanti.com), so the
    // post_login_redirect_uri it sends to /.auth/login/<provider> (see
    // frontend/src/lib/api.js loginUrl()) is "external" as far as Easy
    // Auth is concerned. Without the host listed here Easy Auth silently
    // drops the parameter and finishes on its own /.auth/login/done page
    // on THIS host instead of returning to the frontend. Reuses
    // corsOriginList so the frontend origin is declared once per
    // environment, in the .bicepparam file's corsOrigins.
    login: {
      allowedExternalRedirectUrls: corsOriginList
    }
    globalValidation: {
      unauthenticatedClientAction: 'Return401'
    }
    // union() so each provider block exists only when that provider is
    // configured -- an Entra-only, Google-only, or both deployment.
    identityProviders: union(
      entraEnabled ? {
        azureActiveDirectory: {
          enabled: true
          registration: {
            clientId: entraClientId
            clientSecretSettingName: 'entra-client-secret'
            // The 'consumers' endpoint, not a tenant-specific one: this app
            // registration is deliberately Personal Microsoft accounts only
            // (any contributor's outlook.com/hotmail/live account, or any
            // other Microsoft account -- not scoped to this deployment's own
            // Entra tenant), so end-user sign-in has no dependency on
            // entraTenantId at all -- see infra/README.md "Register an Entra
            // ID app for Easy Auth". Postgres AAD auth (modules/postgres.bicep)
            // is a separate, still tenant-scoped concern.
            openIdIssuer: '${environment().authentication.loginEndpoint}consumers/v2.0'
          }
          validation: {
            defaultAuthorizationPolicy: {
              allowedApplications: [entraClientId]
            }
          }
        }
      } : {},
      googleEnabled ? {
        google: {
          enabled: true
          registration: {
            clientId: googleClientId
            clientSecretSettingName: 'google-client-secret'
          }
          // Easy Auth asks for openid, profile and email by default; email
          // is what backend/app/auth.py keys users on.
          login: {
            scopes: ['openid', 'profile', 'email']
          }
        }
      } : {}
    )
  }
}

output fqdn string = containerApp.properties.configuration.ingress.fqdn
output name string = containerApp.name
@description('''Value to put in a TXT record at asuid.<hostname> to prove
ownership before `az containerapp hostname add` will accept a custom
domain for this app -- see infra/README.md "Custom domains". Kept as an
output purely for convenience during that manual, one-time step; nothing
in this template consumes it.''')
output customDomainVerificationId string = containerApp.properties.customDomainVerificationId
@description('The public URL to reach this API at: customDomainName once it has actually been bound out-of-band (see that param's description), otherwise the auto-generated fqdn. This is what the frontend build targets and what Easy Auth\'s sign-in redirect must match -- see infra/README.md "Custom domains".')
output url string = 'https://${!empty(customDomainName) ? customDomainName : containerApp.properties.configuration.ingress.fqdn}'
