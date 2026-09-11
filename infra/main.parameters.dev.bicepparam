using 'main.bicep'

param appName = 'vacationplanner'
param envName = 'dev'
param postgresSkuName = 'Standard_B1ms'
param corsOrigins = 'https://vacations.dev.amandasanti.com'
param backendCustomDomainName = 'vacations-api.dev.amandasanti.com'
param frontendCustomDomainName = 'vacations.dev.amandasanti.com'

// A managed certificate for vacations-api.dev.amandasanti.com already
// exists in the vacationplanner-dev Container Apps environment under this
// name (created outside this template's own naming scheme at some point --
// its name doesn't match replace(backendCustomDomainName, '.', '-')).
// Pointing at it directly avoids DuplicateManagedCertificateInEnvironment /
// CertificateNotFound. See modules/container-app-backend.bicep's
// existingCertificateResourceId param and infra/README.md "Custom domains".
param backendExistingCertificateResourceId = '/subscriptions/d0f0c175-8220-4f62-bda4-195732caf2f8/resourceGroups/vacationplanner-dev/providers/Microsoft.App/managedEnvironments/vacationplanner-dev/managedCertificates/vacations-api.dev.amandasant-vacation-260911042853'

// Optional -- only needed for the one-time manual Easy Auth rollout
// (infra/README.md step 5's second pass). The GitHub Actions workflow
// supplies these separately via its own `parameters` input, not through
// this file. Left unset (empty), these fall through to main.bicep's own
// defaults ('') so the Container App deploys with Easy Auth off, same as
// before this file existed.
param entraClientId = readEnvironmentVariable('ENTRA_CLIENT_ID', '')
param entraClientSecret = readEnvironmentVariable('ENTRA_CLIENT_SECRET', '')
