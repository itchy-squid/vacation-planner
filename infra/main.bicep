// Resource-group-scoped deployment for the vacation planner. Run with:
//   az deployment group create -g <resource-group> -f infra/main.bicep -p infra/main.parameters.json
// (or let .github/workflows/deploy.yml do it on push to main — see that
// file and infra/README.md for the one-time setup this needs first.)
targetScope = 'resourceGroup'

@description('Short, unique-ish name segment used to build resource names, e.g. "vacplanner-dev".')
param appName string = 'vacplanner'

@description('Deployment environment name, used in resource naming.')
@allowed(['dev', 'staging', 'prod'])
param envName string = 'dev'

param location string = resourceGroup().location

@description('Postgres administrator login (not used by the app at runtime — the app connects with its own connection string).')
param postgresAdminLogin string = 'plannerAdmin'

@secure()
@description('Postgres administrator password. Pass via --parameters or a GitHub secret; never commit a real value.')
param postgresAdminPassword string

@description('Backend container image, e.g. myregistry.azurecr.io/vacation-planner-backend:sha-abc1234. Set by CI after building the image.')
param backendContainerImage string = 'mcr.microsoft.com/k8se/quickstart:latest' // placeholder until CI pushes a real image

@description('Comma-separated allowed CORS origins for the backend, typically the Static Web App URL.')
param corsOrigins string = '*'

@description('Entra ID app registration client ID for Easy Auth. Leave empty to deploy without auth turned on yet — see infra/README.md.')
param entraClientId string = ''
param entraTenantId string = subscription().tenantId
@secure()
param entraClientSecret string = ''

var suffix = '${appName}-${envName}'
var registryName = replace('${appName}${envName}acr', '-', '') // ACR names must be alphanumeric only

module logAnalytics 'modules/log-analytics.bicep' = {
  name: 'log-analytics'
  params: {
    location: location
    name: 'log-${suffix}'
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
    name: 'pg-${suffix}'
    administratorLogin: postgresAdminLogin
    administratorPassword: postgresAdminPassword
  }
}

module containerAppsEnv 'modules/container-apps-env.bicep' = {
  name: 'container-apps-env'
  params: {
    location: location
    name: 'cae-${suffix}'
    logAnalyticsCustomerId: logAnalytics.outputs.customerId
    logAnalyticsSharedKey: logAnalytics.outputs.sharedKey
  }
}

var databaseUrl = 'postgresql+psycopg://${postgresAdminLogin}:${postgresAdminPassword}@${postgres.outputs.fqdn}:5432/${postgres.outputs.databaseName}?sslmode=require'

module backend 'modules/container-app-backend.bicep' = {
  name: 'backend'
  params: {
    location: location
    name: 'ca-${suffix}-backend'
    containerAppsEnvironmentId: containerAppsEnv.outputs.id
    containerImage: backendContainerImage
    registryLoginServer: registry.outputs.loginServer
    registryUsername: registry.outputs.name
    registryPassword: registry.outputs.adminPassword
    databaseUrl: databaseUrl
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
    name: 'swa-${suffix}'
  }
}

output backendUrl string = 'https://${backend.outputs.fqdn}'
output frontendUrl string = 'https://${frontend.outputs.defaultHostname}'
output registryLoginServer string = registry.outputs.loginServer
output postgresFqdn string = postgres.outputs.fqdn
