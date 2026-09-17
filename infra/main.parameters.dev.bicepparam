using 'main.bicep'

param appName = 'vacationplanner'
param envName = 'dev'
param postgresSkuName = 'Standard_B1ms'
param corsOrigins = 'https://vacations.dev.amandasanti.com'
param frontendCustomDomainName = 'vacations.dev.amandasanti.com'
// The backend's custom domain is bound out-of-band (az containerapp
// hostname add/bind), not by this template -- see infra/README.md
// "Custom domains". Set here purely so backendUrl (what the frontend
// build targets, and what Easy Auth's sign-in redirect must match)
// reflects the actually-bound hostname instead of the auto-generated one.
param backendCustomDomainName = 'vacations-api.dev.amandasanti.com'

// Optional -- only needed for the one-time manual Easy Auth rollout
// (infra/README.md step 5's second pass). The GitHub Actions workflow
// supplies these separately via its own `parameters` input, not through
// this file. Left unset (empty), these fall through to main.bicep's own
// defaults ('') so the Container App deploys with Easy Auth off, same as
// before this file existed.
param entraClientId = readEnvironmentVariable('ENTRA_CLIENT_ID', '')
param entraClientSecret = readEnvironmentVariable('ENTRA_CLIENT_SECRET', '')
param googleClientId = readEnvironmentVariable('EASY_AUTH_GOOGLE_CLIENT_ID', '')
param googleClientSecret = readEnvironmentVariable('EASY_AUTH_GOOGLE_CLIENT_SECRET', '')
