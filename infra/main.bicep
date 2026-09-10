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

@description('''Object ID of the Microsoft Entra principal (typically you)
to designate as the Postgres server's Microsoft Entra Administrator — the
one role Azure provisions for you with no SQL required. See infra/README.md
"Managed identity database auth" for what to do with it once the server
exists (running infra/sql/provision_roles.sql to set up the app/maintainer
roles this admin identity can then grant).''')
param postgresAadAdminObjectId string
@description('Display name / UPN of that principal, e.g. amanda.burch@gmail.com.')
param postgresAadAdminPrincipalName string
@description('"User" | "Group" | "ServicePrincipal" — what kind of principal postgresAadAdminObjectId is.')
@allowed(['User', 'Group', 'ServicePrincipal'])
param postgresAadAdminPrincipalType string = 'User'

@description('Backend container image, e.g. myregistry.azurecr.io/vacation-planner-backend:sha-abc1234. Set by CI after building the image.')
param backendContainerImage string = 'mcr.microsoft.com/k8se/quickstart:latest' // placeholder until CI pushes a real image

@description('Comma-separated allowed CORS origins for the backend, typically the Static Web App URL.')
param corsOrigins string = '*'

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
var registryName = replace('${suffix}acr', '-', '') // ACR names must be alphanumeric only

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
    aadAdminObjectId: postgresAadAdminObjectId
    aadAdminPrincipalName: postgresAadAdminPrincipalName
    aadAdminPrincipalType: postgresAadAdminPrincipalType
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
  }
}

output backendUrl string = 'https://${backend.outputs.fqdn}'
output frontendUrl string = 'https://${frontend.outputs.defaultHostname}'
output registryLoginServer string = registry.outputs.loginServer
output postgresFqdn string = postgres.outputs.fqdn
output postgresServerName string = postgres.outputs.serverName
@description('Object ID of the backend managed identity — pass this to pgaadauth_create_principal_with_oid(..., objectType=\'service\') in infra/sql/provision_roles.sql to map it to the postgresAppRole Postgres role.')
output backendIdentityObjectId string = backendIdentity.outputs.principalId
