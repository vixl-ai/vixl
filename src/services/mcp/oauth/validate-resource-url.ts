const canonicalResourceUrl = (value: string | URL): URL => {
  const url = new URL(typeof value === 'string' ? value : value.href)
  if (!url.protocol) {
    throw new Error('Resource URL must have a scheme')
  }
  url.hash = ''
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '')
  }
  return url
}

const checkResourceAllowed = ({
  requestedResource,
  configuredResource,
}: {
  requestedResource: URL
  configuredResource: URL
}): boolean => {
  if (requestedResource.origin !== configuredResource.origin) {
    return false
  }

  if (requestedResource.pathname.length < configuredResource.pathname.length) {
    return false
  }

  const requestedPath = requestedResource.pathname.endsWith('/')
    ? requestedResource.pathname
    : `${requestedResource.pathname}/`
  const configuredPath = configuredResource.pathname.endsWith('/')
    ? configuredResource.pathname
    : `${configuredResource.pathname}/`

  return requestedPath.startsWith(configuredPath)
}

const validateResourceUrl = async (
  serverUrl: string | URL,
  resource?: string,
): Promise<URL | undefined> => {
  const requested = canonicalResourceUrl(serverUrl)
  if (!resource) {
    return undefined
  }

  const advertised = canonicalResourceUrl(resource)
  if (
    !checkResourceAllowed({
      requestedResource: requested,
      configuredResource: advertised,
    })
  ) {
    throw new Error(
      `Protected resource ${resource} does not match expected ${requested.href}`,
    )
  }

  return advertised
}

export default validateResourceUrl
