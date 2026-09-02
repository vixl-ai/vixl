import type { OAuthClientInformation } from '@ai-sdk/mcp'

export type StoredOAuthDcrClient = OAuthClientInformation & {
  redirect_uris?: string[]
}
