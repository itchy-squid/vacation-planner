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
record, using the customDomainVerificationId output below).''')
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

@description('Set to enable Azure Easy Auth with Entra ID. Leave clientId empty to deploy without auth turned on yet (see infra/README.md).')
param entraTenantId string = ''
param entraClientId string = ''
@secure()
param entraClientSecret string = ''

var authEnabled = !empty(entraClientId)

// Needed only to parent the managed certificate below -- the container app
// itself is still pointed at the environment via containerAppsEnvironmentId.
resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: last(split(containerAppsEnvironmentId, '/'))
}

// Free, Azure-managed TLS certificate for customDomainName. Validated via
// CNAME + the asuid TXT record (see customDomainVerificationId output)
// at deploy time -- this resource's creation fails outright if those DNS
// records aren't in place and resolving yet.
resource managedCertificate 'Microsoft.App/managedEnvironments/managedCertificates@2024-03-01' = if (!empty(customDomainName)) {
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
        customDomains: !empty(customDomainName) ? [
          {
            name: customDomainName
            certificateId: managedCertificate.id
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
            { name: 'CORS_ORIGINS', value: corsOrigins }
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
@description('The public URL to reach this API at: the custom domain once bound, otherwise the auto-generated fqdn.')
output url string = 'https://${!empty(customDomainName) ? customDomainName : containerApp.properties.configuration.ingress.fqdn}'
