import type { WwwAuthenticateChallenge } from '@/types/mcp/www-authenticate-challenge'

const PARAM = /([a-zA-Z0-9_]+)=(?:"((?:\\.|[^"])*)"|([^\s,]+))/g

const unescapeQuoted = (value: string): string =>
  value.replace(/\\(.)/g, '$1')

const parseBearerParams = (
  header: string,
): Record<string, string> => {
  const params: Record<string, string> = {}
  const bearerIndex = header.search(/bearer\s+/i)
  if (bearerIndex < 0) {
    return params
  }

  const rest = header.slice(bearerIndex)
  for (const match of rest.matchAll(PARAM)) {
    const name = match[1]?.toLowerCase()
    if (!name) {
      continue
    }
    const quoted = match[2]
    const token = match[3]
    params[name] =
      quoted !== undefined ? unescapeQuoted(quoted) : (token ?? '')
  }
  return params
}

const parseWwwAuthenticate = (
  header: string | null | undefined,
): WwwAuthenticateChallenge | undefined => {
  if (!header || header.trim().length === 0) {
    return undefined
  }

  const params = parseBearerParams(header)
  if (Object.keys(params).length === 0 && !/^\s*bearer\b/i.test(header)) {
    return undefined
  }

  let resourceMetadataUrl: URL | undefined
  const rawMetadata = params.resource_metadata
  if (rawMetadata) {
    try {
      resourceMetadataUrl = new URL(rawMetadata)
    } catch {
      resourceMetadataUrl = undefined
    }
  }

  const scope = params.scope?.trim() ? params.scope : undefined
  const error = params.error?.trim() ? params.error : undefined

  if (!resourceMetadataUrl && !scope && !error) {
    return undefined
  }

  return { resourceMetadataUrl, scope, error }
}

export default parseWwwAuthenticate
