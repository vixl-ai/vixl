import type { VixlSettings } from '@/types/vixl/vixl-settings'

export type OAuthCallbackPayload = {
  code: string
  state: string
  iss?: string | null
  error?: string | null
  errorDescription?: string | null
  errorUri?: string | null
  flowId?: string
}

export type McpRuntimeOptions = {
  settings?: VixlSettings
  confirmAuthorizationServerOrigin?: (origin: string) => Promise<boolean>
  skipTrustCheck?: boolean
  scope?: string
  resourceMetadataUrl?: URL
}

export const OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000
