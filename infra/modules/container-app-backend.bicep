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

@description('''Optional custom domain to bind to this Container App, e.g.
vacations-api.dev.amandasanti.com. Leave empty on the first deploy of a new
environment -- see the matching parameter in modules/static-web-app.bicep
for the same two-pass rollout reasoning, and infra/README.md "Custom
domains" for the exact DNS records this needs (a CNAME plus an asuid TXT
record, using the customDomainVerificationId output below). Setting this
alone only creates+validates the managed certificate -- it does NOT yet
move the Container App's ingress onto the custom domain; see
bindCustomDomain below for why that's a separate step.''')
param customDomainName string = ''

@description('''Set to true only once customDomainName's managed
certificate, created by a prior deploy with this still false, shows status
"Succeeded" (`az containerapp env certificate list -g <rg> -n <env-name>`).
This then moves the Container App's ingress onto customDomainName. Kept as
its own step, deliberately not auto-sequenced by Bicep even though it
could be: Container Apps issues managed certificates asynchronously, and
referencing a certificate's resource ID in the ingress before Azure has
actually finished issuing it is a known source of non-deterministic
deployment failures (see infra/README.md "Custom domains" for the exact
rollout and links to the open upstream issues about this). Ignored while
customDomainName is empty.''')
param bindCustomDomain bool = false

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

@description('Set to enable Azure Easy Auth with Entra ID. Leave clientId empty to deploy without auth turned on yet (see infra/README.md).')
param entraTenantId string = ''
param entraClientId string = ''
@secure()
param entraClientSecret string = ''

@description('''Full resource ID of an already-existing managed
certificate for customDomainName, when one was created outside this
template's naming scheme -- e.g. via `az containerapp hostname bind`,
which auto-generates its own certificate name/suffix rather than the
replace(customDomainName, '.', '-') name this template uses. Azure
allows only one managed certificate per subject name per environment, so
deploying this template unchanged against an environment that already has
such a stray certificate fails with DuplicateManagedCertificateInEnvironment
(create) / CertificateNotFound (ingress, since it looks for the name this
template expects instead). Set this to point ingress at the certificate
that already exists instead of creating a new one -- see infra/README.md
"Custom domains". Leave empty for a fresh environment with no certificate
yet; this template will create+own one under its own deterministic
name.''')
param existingCertificateResourceId string = ''

var authEnabled = !empty(entraClientId)

// Single source of truth for CORS: enforced entirely at the Container
// Apps ingress (below), not in application code -- see
// backend/app/main.py, which no longer runs its own CORSMiddleware.
// Local dev sidesteps CORS altogether via the Vite dev server's proxy
// (frontend/vite.config.js) rather than needing a second policy here.
var corsOriginList = [for origin in split(corsOrigins, ','): trim(origin)]

// Needed only to parent the managed certificate below -- the container app
// itself is still pointed at the environment via containerAppsEnvironmentId.
resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: last(split(containerAppsEnvironmentId, '/'))
}

// Free, Azure-managed TLS certificate for customDomainName. Validated via
// CNAME + the asuid TXT record (see customDomainVerificationId output)
// at deploy time -- this resource's creation fails outright if those DNS
// records aren't in place and resolving yet.
resource managedCertificate 'Microsoft.App/managedEnvironments/managedCertificates@2024-03-01' = if (!empty(customDomainName) && empty(existingCertificateResourceId)) {
  parent: containerAppsEnvironment
  name: replace(customDomainName, '.', '-')
  location: location
  properties: {
    subjectName: customDomainName
    domainControlValidation: 'CNAME'
  }
}

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
        // Built with resourceId(...) rather than managedCertificate.id on
        // purpose -- referencing the resource symbol here would make Bicep
        // add an unconditional dependsOn on it even while it doesn't exist
        // (customDomainName empty), which fails template validation with
        // "resource ... is not defined in the template". A plain
        // resourceId() has no such side effect. existingCertificateResourceId
        // (see its param description) takes priority when set, pointing at
        // a certificate this template didn't create.
        customDomains: bindCustomDomain ? [
          {
            name: customDomainName
            certificateId: !empty(existingCertificateResourceId) ? existingCertificateResourceId : resourceId('Microsoft.App/managedEnvironments/managedCertificates', last(split(containerAppsEnvironmentId, '/')), replace(customDomainName, '.', '-'))
            bindingType: 'SniEnabled'
          }
        ] : []
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
        authEnabled ? [{ name: 'entra-client-secret', value: entraClientSecret }] : []
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
// Entra ID sign-in at the platform edge and forwarding the signed-in user
// to the app via X-MS-CLIENT-PRINCIPAL* headers — see backend/app/auth.py.
// Only created once an Entra app registration's client ID is supplied;
// until then the Container App deploys without auth turned on. See
// infra/README.md for the app-registration steps (manual, one-time).
resource authConfig 'Microsoft.App/containerApps/authConfigs@2024-03-01' = if (authEnabled) {
  parent: containerApp
  name: 'current'
  properties: {
    platform: { enabled: true }
    globalValidation: {
      unauthenticatedClientAction: 'Return401'
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: entraClientId
          clientSecretSettingName: 'entra-client-secret'
          openIdIssuer: '${environment().authentication.loginEndpoint}${entraTenantId}/v2.0'
        }
        validation: {
          defaultAuthorizationPolicy: {
            allowedApplications: [entraClientId]
          }
        }
      }
    }
  }
}

output fqdn string = containerApp.properties.configuration.ingress.fqdn
output name string = containerApp.name
@description('''Value to put in a TXT record at asuid.<customDomainName> to
prove ownership before Azure will bind that hostname -- see
infra/README.md "Custom domains".''')
output customDomainVerificationId string = containerApp.properties.customDomainVerificationId
@description('The public URL to reach this API at: the custom domain once bindCustomDomain has actually moved the ingress onto it, otherwise the auto-generated fqdn.')
output url string = 'https://${bindCustomDomain ? customDomainName : containerApp.properties.configuration.ingress.fqdn}'
