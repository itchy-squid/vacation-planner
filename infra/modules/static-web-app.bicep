@description('Azure Static Web App hosting the built React/Vite frontend.')
param location string
param name string
param sku string = 'Free'

@description('''Optional custom domain to bind to this Static Web App, e.g.
vacations.dev.amandasanti.com. Leave empty on the first deploy of a new
environment -- this resource validates ownership via a CNAME lookup at
deploy time, so it fails unless a CNAME record for this hostname already
resolves to the Static Web App's defaultHostname output. Two-pass rollout:
deploy once with this empty to learn defaultHostname, create the CNAME
record at your DNS provider pointing this hostname at defaultHostname,
wait for it to resolve, then redeploy with this param set. Azure issues a
free managed TLS certificate automatically once validated -- see
infra/README.md "Custom domains".''')
param customDomainName string = ''

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

resource customDomain 'Microsoft.Web/staticSites/customDomains@2023-12-01' = if (!empty(customDomainName)) {
  parent: staticWebApp
  name: customDomainName
}

output defaultHostname string = staticWebApp.properties.defaultHostname
output name string = staticWebApp.name
@description('The public URL to reach this app at: the custom domain once bound, otherwise the auto-generated defaultHostname.')
output url string = 'https://${!empty(customDomainName) ? customDomainName : staticWebApp.properties.defaultHostname}'
