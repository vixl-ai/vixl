import type { OAuthClientMetadata } from '@ai-sdk/mcp'

const nativeClientMetadata = (redirectUrl: string): OAuthClientMetadata => ({
  client_name: 'Vixl',
  application_type: 'native',
  redirect_uris: [redirectUrl],
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
})

export default nativeClientMetadata
