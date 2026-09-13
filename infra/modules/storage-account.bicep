@description('''Private blob storage for pin photos mirrored from links
people paste into the app (see backend/app/photo_storage.py) — a copy this
app owns, kept behind the backend, rather than a trip's pins staying
dependent on some other site's page forever and hotlinking its traffic
indefinitely.

Deliberately private: allowBlobPublicAccess is off at the account level
and the container grants no anonymous access, so a photo's URL is useless
outside the app. The backend's managed identity reads/writes blobs
directly via its own Entra ID auth (Storage Blob Data Contributor below —
same "no stored keys" approach as modules/postgres.bicep's AAD-only
Postgres auth) and mints short-lived read URLs for clients using a
user-delegation key (Storage Blob Delegator below) rather than an account
key — see photo_storage.py's sign_photo_url for where that happens.

Unlike modules/postgres.bicep's AAD Administrator, both role assignments
here are plain ARM resources: Microsoft.Authorization/roleAssignments
works fine against a storage account (the Postgres module's manual step
is specifically about a resource type that doesn't), so this module needs
no follow-up manual step.''')
param location string
param name string

@description('Object ID of the managed identity to grant blob read/write and SAS-delegation rights to (infra/modules/managed-identity.bicep).')
param backendIdentityPrincipalId string

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

// Lets the backend's own managed identity read/write blob content
// directly (photo_storage.py's own uploads use this, via
// DefaultAzureCredential — no stored account key).
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
resource dataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, backendIdentityPrincipalId, storageBlobDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
    principalId: backendIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Lets the backend mint short-lived user-delegation SAS URLs for clients
// to read one photo at a time, without ever holding an account key —
// see photo_storage.py's sign_photo_url.
var storageBlobDelegatorRoleId = 'db58b8e5-c6ad-4a2a-8342-4190687cbf4a'
resource delegator 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, backendIdentityPrincipalId, storageBlobDelegatorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDelegatorRoleId)
    principalId: backendIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output blobEndpoint string = storage.properties.primaryEndpoints.blob
output containerName string = container.name
output accountName string = storage.name
