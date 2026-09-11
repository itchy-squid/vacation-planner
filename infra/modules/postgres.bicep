@description('''Azure Database for PostgreSQL Flexible Server + the app
database, using Microsoft Entra ID (Azure AD) authentication only — no
Postgres password auth at all, per the "any auth to the database should use
managed identities" requirement. See infra/README.md "Managed identity
database auth" for the full picture, and infra/sql/provision_roles.sql for
the role/privilege setup that runs once against the database itself.

Two things this module deliberately does NOT provision, both done by hand
instead (see infra/README.md "One-time manual setup", step 6):
  - The Microsoft Entra Administrator on the server. Bicep's own
    Microsoft.DBforPostgreSQL/flexibleServers/administrators resource
    reliably fails with an opaque InternalServerError (no further detail)
    when created here — a known, unresolved issue on Azure's side (see
    the Microsoft Q&A threads on this exact resource type), not something
    wrong in this template. Run `az postgres flexible-server ad-admin
    create` against the server this module creates instead.
  - Table-level privileges, since that's a database-level SQL operation
    ARM has no resource type for (infra/sql/provision_roles.sql).''')
param location string
param name string
param databaseName string = 'vacation_planner'
param skuName string = 'Standard_B1ms'
param tier string = 'Burstable'
param storageSizeGB int = 32
param postgresVersion string = '16'

@description('Microsoft Entra tenant ID that Postgres AAD auth trusts.')
param entraTenantId string = tenant().tenantId

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

// The Microsoft Entra Administrator (flexibleServers/administrators) is
// intentionally NOT provisioned here — see the module doc comment above.
// It's created by hand via `az postgres flexible-server ad-admin create`
// (infra/README.md "One-time manual setup", step 6) once this server
// exists.

output fqdn string = server.properties.fullyQualifiedDomainName
output databaseName string = database.name
output serverName string = server.name
