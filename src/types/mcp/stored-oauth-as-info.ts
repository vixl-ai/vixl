import type { OAuthAuthorizationServerInformation } from '@ai-sdk/mcp'

export type StoredOAuthAsInfo = OAuthAuthorizationServerInformation & {
  origin?: string
  authorization_response_iss_parameter_supported?: boolean
}
