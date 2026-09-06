@description('The FastAPI/uvicorn backend as an Azure Container App, with Easy Auth (Entra ID) in front of it.')
param location string
param name string
param containerAppsEnvironmentId string
param containerImage string
param registryLoginServer string
param registryUsername string
@secure()
param registryPassword string
@secure()
param databaseUrl string
param corsOrigins string

@description('Set to enable Azure Easy Auth with Entra ID. Leave clientId empty to deploy without auth turned on yet (see infra/README.md).')
param entraTenantId string = ''
param entraClientId string = ''
@secure()
param entraClientSecret string = ''

var authEnabled = !empty(entraClientId)

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  properties: {
    managedEnvironmentId: containerAppsEnvironmentId
    configuration: {
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto'
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
          { name: 'database-url', value: databaseUrl }
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
            { name: 'DATABASE_URL', secretRef: 'database-url' }
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
