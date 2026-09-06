@description('Azure Container Registry the backend image is pushed to by CI.')
param location string
param name string

resource registry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: name
  location: location
  sku: { name: 'Basic' }
  properties: {
    // Admin credentials keep the first-pass CI/CD workflow simple (see
    // .github/workflows/deploy.yml). A managed-identity pull is the more
    // secure follow-up — see root README "Next steps".
    adminUserEnabled: true
  }
}

output id string = registry.id
output loginServer string = registry.properties.loginServer
output name string = registry.name
@secure()
output adminPassword string = registry.listCredentials().passwords[0].value
