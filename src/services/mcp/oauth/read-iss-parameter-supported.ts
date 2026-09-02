import { mcpOAuthFetch } from '@/services/mcp/mcp-oauth-fetch'

const wellKnownUrls = (authorizationServerUrl: string): URL[] => {
  const url = new URL(authorizationServerUrl)
  const pathname = url.pathname.endsWith('/')
    ? url.pathname.slice(0, -1)
    : url.pathname
  const urls = [
    new URL('/.well-known/oauth-authorization-server', url.origin),
    new URL('/.well-known/openid-configuration', url.origin),
  ]
  if (pathname !== '') {
    urls.unshift(
      new URL(
        `/.well-known/oauth-authorization-server${pathname}`,
        url.origin,
      ),
      new URL(`/.well-known/openid-configuration${pathname}`, url.origin),
    )
  }
  return urls
}

const flagFromBody = (body: unknown): boolean | undefined => {
  if (!body || typeof body !== 'object') {
    return undefined
  }
  if (!('authorization_response_iss_parameter_supported' in body)) {
    return undefined
  }
  const flag = body.authorization_response_iss_parameter_supported
  return typeof flag === 'boolean' ? flag : undefined
}

const readIssParameterSupported = async (
  authorizationServerUrl: string,
): Promise<boolean | undefined> => {
  for (const endpoint of wellKnownUrls(authorizationServerUrl)) {
    try {
      const response = await mcpOAuthFetch(endpoint, {
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) {
        continue
      }
      const flag = flagFromBody(await response.json())
      if (flag !== undefined) {
        return flag
      }
    } catch {
      continue
    }
  }
  return undefined
}

export default readIssParameterSupported
