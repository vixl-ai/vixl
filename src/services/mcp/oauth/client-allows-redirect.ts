const clientAllowsRedirect = (
  client: { redirect_uris?: unknown },
  redirectUrl: string,
): boolean => {
  if (!Array.isArray(client.redirect_uris)) {
    return false
  }
  return client.redirect_uris.some(
    (uri) => typeof uri === 'string' && uri === redirectUrl,
  )
}

export default clientAllowsRedirect
