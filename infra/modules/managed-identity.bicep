@description('''A user-assigned managed identity for the backend Container
App to authenticate to Azure Database for PostgreSQL Flexible Server with —
no stored database password anywhere (see infra/README.md "Managed identity
database auth"). User-assigned (rather than the Container App's built-in
system-assigned identity) so its client ID is stable and known at Bicep
deploy time, for use in the app's AZURE_CLIENT_ID env var and in
infra/sql/provision_roles.sql's principal mapping.''')
param location string
param name string

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: name
  location: location
}

output id string = identity.id
output clientId string = identity.properties.clientId
output principalId string = identity.properties.principalId
