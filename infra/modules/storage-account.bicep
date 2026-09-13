@description('''Private blob storage for pin photos mirrored from links
people paste into the app (see backend/app/photo_storage.py) — a copy this
app owns, kept behind the backend, rather than a trip's pins staying
dependent on some other site's page forever and hotlinking its traffic
indefinitely.

Deliberately private: allowBlobPublicAccess is off at the account level
and the container grants no anonymous access, so a photo's URL is useless
outside the app. The backend's managed identity reads/writes blobs
directly via its own Entra ID auth (Storage Blob Data Contributor — same
"no stored keys" approach as modules/postgres.bicep's AAD-only Postgres
auth) and mints short-lived read URLs for clients using a user-delegation
key (Storage Blob Delegator) rather than an account key — see
photo_storage.py's sign_photo_url for where that happens.

Both role assignments the backend identity needs are plain ARM resources
— unlike modules/postgres.bicep's AAD Administrator, this resource type
has no Azure-side bug blocking it from being created via Bicep. But
they're not provisioned here either: this repo's GitHub Actions deploy
identity only holds Contributor on the resource group (infra/README.md
"Continuous deployment"), and built-in Contributor explicitly excludes
`Microsoft.Authorization/*/Write` — so CI can create the storage account
and container fine but is blocked from writing role assignments (the
exact `Microsoft.Authorization/roleAssignments/write` action). Rather
than widen the deploy identity's privileges just for this (see
claude/db-privilege-provisioning.md for the running theme of keeping
standing privilege narrow), granting the backend identity these two roles
is a one-time manual step per environment instead — same shape as the
Postgres AAD Administrator above: see infra/README.md "One-time manual
setup", step 7.''')
param location string
param name string

param containerName string = 'pin-photos'

// Storage account names: 3-24 chars, lowercase letters and digits only,
// globally unique across all of Azure (same real-world constraint as
// modules/container-registry.bicep's registry name, handled there the
// same way — by relying on `name` already being distinctive rather than
// appending a generated suffix). `take(...)` is defensive: guards against
// a longer, customized `appName` (main.bicep) pushing this past 24 chars.
var storageAccountName = take(toLower(replace('${name}pinphotos', '-', '')), 24)

resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storage
  name: 'default'
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: containerName
  properties: {
    publicAccess: 'None'
  }
}

// The two role assignments the backend's managed identity needs —
// Storage Blob Data Contributor (direct blob read/write) and Storage
// Blob Delegator (minting user-delegation SAS URLs) — are intentionally
// NOT provisioned here. See the module doc comment above: the CI deploy
// identity can't write role assignments, so these are granted by hand
// via `az role assignment create` (infra/README.md "One-time manual
// setup", step 7) once this storage account exists.

output blobEndpoint string = storage.properties.primaryEndpoints.blob
output containerName string = container.name
output accountName string = storage.name
