@description('''Azure Database for PostgreSQL Flexible Server + the app
database, using Microsoft Entra ID (Azure AD) authentication only — no
Postgres password auth at all, per the "any auth to the database should use
managed identities" requirement. See infra/README.md "Managed identity
database auth" for the full picture, and infra/sql/provision_roles.sql for
the role/privilege setup that runs once against the database itself
(ARM/Bicep only reaches as far as the server and its AAD administrator —
granting table privileges is a data-plane SQL step, not a resource one).''')
param location string
param name string
param databaseName string = 'vacation_planner'
param skuName string = 'Standard_B1ms'
param tier string = 'Burstable'
param storageSizeGB int = 32
param postgresVersion string = '16'

@description('Microsoft Entra tenant ID that Postgres AAD auth trusts.')
param entraTenantId string = tenant().tenantId

@description('''Object ID of the Microsoft Entra principal (a user — you —
or a group) to designate as this server's Microsoft Entra Administrator.
This is an elevated, break-glass-style role (member of azure_pg_admin, can
run pgaadauth_create_principal_with_oid to map new AAD principals to
Postgres roles) — see infra/README.md before using it for everyday
queries.''')
param aadAdminObjectId string

@description('Display name / UPN of the AAD admin principal above, shown in the Azure portal.')
param aadAdminPrincipalName string

@description('"User" | "Group" | "ServicePrincipal" — the type of the AAD admin principal above.')
@allowed(['User', 'Group', 'ServicePrincipal'])
param aadAdminPrincipalType string = 'User'

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: name
  location: location
  sku: {
    name: skuName
    tier: tier
  }
  properties: {
    version: postgresVersion
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: entraTenantId
    }
    storage: { storageSizeGB: storageSizeGB }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: { mode: 'Disabled' }
    // Public access + "allow Azure services" is the simplest path for a
    // first deployment. VNet integration / private endpoints are the
    // production-hardening follow-up — see root README "Next steps".
    network: {}
  }
}

resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: server
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Designates the Microsoft Entra Administrator — the one Postgres role
// Azure itself provisions for you, with no SQL required. Every other
// Postgres role (the app's managed identity, individual maintainers) is
// mapped in by this admin running infra/sql/provision_roles.sql, since
// that's a database-level operation ARM has no resource type for.
resource aadAdmin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: server
  name: aadAdminObjectId
  properties: {
    principalType: aadAdminPrincipalType
    principalName: aadAdminPrincipalName
    tenantId: entraTenantId
  }
}

output fqdn string = server.properties.fullyQualifiedDomainName
output databaseName string = database.name
output serverName string = server.name
