// Resource-group-scoped deployment for the vacation planner. Run with:
//   az deployment group create -g <resource-group> -f infra/main.bicep -p infra/main.parameters.json
// (or let .github/workflows/deploy.yml do it on push to main — see that
// file and infra/README.md for the one-time setup this needs first.)
targetScope = 'resourceGroup'

@description('Short, unique-ish name segment used to build resource names, e.g. "vacationplanner".')
param appName string = 'vacationplanner'

@description('''Deployment environment name, used in resource naming. Dev
resources are named "${appName}-${envName}" (e.g. "vacationplanner-dev");
prod resources are named just appName, with no "-prod" suffix (e.g.
"vacationplanner") -- see the `suffix` variable below.''')
@allowed(['dev', 'prod'])
param envName string = 'dev'

param location string = resourceGroup().location

@description('Backend container image, e.g. myregistry.azurecr.io/vacation-planner-backend:sha-abc1234. Set by CI after building the image.')
param backendContainerImage string = 'mcr.microsoft.com/k8se/quickstart:latest' // placeholder until CI pushes a real image

@description('Comma-separated allowed CORS origins for the backend, typically the Static Web App URL.')
param corsOrigins string = '*'

@description('''Optional custom domain for the backend Container App, e.g.
vacations-api.dev.amandasanti.com. Leave empty on the first deploy of a new
environment -- see modules/container-app-backend.bicep and
infra/README.md "Custom domains" for the two-pass rollout this needs.''')
param backendCustomDomainName string = ''

@description('''Optional custom domain for the frontend Static Web App, e.g.
vacations.dev.amandasanti.com. Leave empty on the first deploy of a new
environment -- see modules/static-web-app.bicep and infra/README.md
"Custom domains" for the two-pass rollout this needs.''')
param frontendCustomDomainName string = ''

@description('Entra ID app registration client ID for Easy Auth. Leave empty to deploy without auth turned on yet — see infra/README.md.')
param entraClientId string = ''
param entraTenantId string = subscription().tenantId
@secure()
param entraClientSecret string = ''

@description('''The Postgres role name the backend's managed identity will
connect as — must match the roleName given to pgaadauth_create_principal_with_oid
in infra/sql/provision_roles.sql for that identity.''')
param postgresAppRole string = 'app-backend'

@description('Postgres Flexible Server compute SKU — kept fixed at Standard_B1ms (Burstable) for both dev and prod.')
param postgresSkuName string = 'Standard_B1ms'

@description('''Base name every resource is derived from. Prod deliberately
gets no environment suffix (just "vacationplanner"), while every other
environment is suffixed (e.g. "vacationplanner-dev") so it can never
collide with prod or with another environment.''')
var suffix = envName == 'prod' ? appName : '${appName}-${envName}'
var registryName = replace(suffix, '-', '') // ACR names must be alphanumeric only

module logAnalytics 'modules/log-analytics.bicep' = {
  name: 'log-analytics'
  params: {
    location: location
    name: suffix
  }
}

module registry 'modules/container-registry.bicep' = {
  name: 'registry'
  params: {
    location: location
    name: registryName
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    location: location
    name: suffix
    skuName: postgresSkuName
    entraTenantId: entraTenantId
  }
}

module containerAppsEnv 'modules/container-apps-env.bicep' = {
  name: 'container-apps-env'
  params: {
    location: location
    name: suffix
    logAnalyticsCustomerId: logAnalytics.outputs.customerId
    logAnalyticsSharedKey: logAnalytics.outputs.sharedKey
  }
}

module backendIdentity 'modules/managed-identity.bicep' = {
  name: 'backend-identity'
  params: {
    location: location
    name: 'id-${suffix}'
  }
}

module backend 'modules/container-app-backend.bicep' = {
  name: 'backend'
  params: {
    location: location
    name: suffix
    containerAppsEnvironmentId: containerAppsEnv.outputs.id
    containerImage: backendContainerImage
    registryLoginServer: registry.outputs.loginServer
    registryUsername: registry.outputs.name
    registryPassword: registry.outputs.adminPassword
    managedIdentityId: backendIdentity.outputs.id
    managedIdentityClientId: backendIdentity.outputs.clientId
    postgresHost: postgres.outputs.fqdn
    postgresDatabase: postgres.outputs.databaseName
    postgresAppRole: postgresAppRole
    corsOrigins: corsOrigins
    customDomainName: backendCustomDomainName
    entraTenantId: entraTenantId
    entraClientId: entraClientId
    entraClientSecret: entraClientSecret
  }
}

module frontend 'modules/static-web-app.bicep' = {
  name: 'frontend'
  params: {
    location: location
    name: suffix
    customDomainName: frontendCustomDomainName
  }
}

output backendUrl string = backend.outputs.url
output frontendUrl string = frontend.outputs.url
@description('Put this as the value of a TXT record at asuid.<backendCustomDomainName> before setting backendCustomDomainName -- see infra/README.md "Custom domains".')
output backendCustomDomainVerificationId string = backend.outputs.customDomainVerificationId
output registryLoginServer string = registry.outputs.loginServer
output postgresFqdn string = postgres.outputs.fqdn
output postgresServerName string = postgres.outputs.serverName
@description('Object ID of the backend managed identity — pass this to pgaadauth_create_principal_with_oid(..., objectType=\'service\') in infra/sql/provision_roles.sql to map it to the postgresAppRole Postgres role.')
output backendIdentityObjectId string = backendIdentity.outputs.principalId
