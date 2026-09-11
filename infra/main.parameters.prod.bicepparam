using 'main.bicep'

param appName = 'vacationplanner'
param envName = 'prod'
param postgresSkuName = 'Standard_B1ms'
param corsOrigins = '*'

// See infra/main.parameters.dev.bicepparam's comment -- same optional,
// env-var-sourced Easy Auth override, unused by the GitHub Actions
// workflow.
param entraClientId = readEnvironmentVariable('ENTRA_CLIENT_ID', '')
param entraClientSecret = readEnvironmentVariable('ENTRA_CLIENT_SECRET', '')
