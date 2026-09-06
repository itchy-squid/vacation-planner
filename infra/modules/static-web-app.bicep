@description('Azure Static Web App hosting the built React/Vite frontend.')
param location string
param name string
param sku string = 'Free'

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: name
  location: location
  sku: {
    name: sku
    tier: sku
  }
  properties: {
    // Deploys happen via the Azure/static-web-apps-deploy GitHub Action
    // (see .github/workflows/deploy.yml), not via a linked repo here.
    buildProperties: {}
  }
}

output defaultHostname string = staticWebApp.properties.defaultHostname
output name string = staticWebApp.name
