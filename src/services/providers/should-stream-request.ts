export default (
  method: string,
  headers?: HeadersInit,
  body?: string,
): boolean => {
  const accept = new Headers(headers ?? {}).get('accept') ?? ''
  if (accept.toLowerCase().includes('text/event-stream')) {
    return true
  }
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') {
    return false
  }
  if (!body) {
    return false
  }
  return body.includes('"stream":true') || body.includes('"stream": true')
}
