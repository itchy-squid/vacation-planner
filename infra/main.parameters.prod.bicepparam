using 'main.bicep'

param appName = 'vacationplanner'
param envName = 'prod'
param postgresSkuName = 'Standard_B1ms'
param corsOrigins = 'https://vacations.amandasanti.com'
param backendCustomDomainName = 'vacations-api.amandasanti.com'
param frontendCustomDomainName = 'vacations.amandasanti.com'

param entraClientId = readEnvironmentVariable('ENTRA_CLIENT_ID', '')
param entraClientSecret = readEnvironmentVariable('ENTRA_CLIENT_SECRET', '')
