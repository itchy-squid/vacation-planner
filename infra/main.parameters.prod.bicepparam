using 'main.bicep'

param appName = 'vacationplanner'
param envName = 'prod'
param postgresSkuName = 'Standard_B1ms'
// Keep one backend replica warm in prod so users never wait on a cold start.
// Dev leaves this at the default 0 (scale to zero).
param backendMinReplicas = 1
param corsOrigins = 'https://vacations.amandasanti.com'
param frontendCustomDomainName = 'vacations.amandasanti.com'
param backendCustomDomainName = 'vacations-api.amandasanti.com'
// Created by `az containerapp hostname bind`, not by this template.
param backendCertificateName = 'vacations-api.amandasanti.co-vacation-260917052839'

param entraClientId = readEnvironmentVariable('ENTRA_CLIENT_ID', '')
param entraClientSecret = readEnvironmentVariable('ENTRA_CLIENT_SECRET', '')
param googleClientId = readEnvironmentVariable('EASY_AUTH_GOOGLE_CLIENT_ID', '')
param googleClientSecret = readEnvironmentVariable('EASY_AUTH_GOOGLE_CLIENT_SECRET', '')
