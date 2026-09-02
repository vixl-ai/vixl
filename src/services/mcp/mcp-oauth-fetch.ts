import proxyFetch from '@/services/providers/proxy-fetch'
import parseWwwAuthenticate from '@/services/mcp/oauth/parse-www-authenticate'
import { recordLastOAuthChallenge } from '@/services/mcp/oauth/last-challenge'

/**
 * Hardened fetch for OAuth discovery / token / DCR.
 * Blocks redirects and private / link-local / metadata targets.
 * Allows https to public hosts, and http only to loopback.
 * Uses the Rust HTTP proxy in Tauri so webview CORS does not apply.
 */
export const mcpOAuthFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid OAuth fetch URL')
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const isLoopback =
    host === 'localhost' || host === '127.0.0.1' || host === '::1'

  if (parsed.protocol === 'http:') {
    if (!isLoopback) {
      throw new Error('OAuth fetch over http is only allowed for localhost')
    }
  } else if (parsed.protocol !== 'https:') {
    throw new Error('OAuth fetch must use https (or http localhost)')
  }

  if (!isLoopback && isBlockedOAuthHost(host)) {
    throw new Error(`OAuth fetch blocked for private host ${parsed.hostname}`)
  }

  const response = await proxyFetch()(input, {
    ...init,
    redirect: 'error',
  })

  if (response.status === 401 || response.status === 403) {
    const challenge = parseWwwAuthenticate(
      response.headers.get('www-authenticate') ??
        response.headers.get('WWW-Authenticate'),
    )
    if (challenge) {
      recordLastOAuthChallenge(parsed, challenge)
    }
  }

  return response
}

const isBlockedOAuthHost = (host: string): boolean => {
  if (
    host === '0.0.0.0' ||
    host === '::' ||
    host === 'metadata.google.internal'
  ) {
    return true
  }
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return true
  }
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return true
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return true
  }
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return true
  }
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
    return true
  }
  return false
}
