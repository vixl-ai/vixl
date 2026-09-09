type ParsedFetchUrl = { ok: true; href: string; hostname: string } | { ok: false; error: string }

const parseFetchUrl = (raw: string): ParsedFetchUrl => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      error: `Unsupported URL protocol: ${url.protocol.replace(/:$/, '')}`,
    }
  }

  if (!url.hostname) {
    return { ok: false, error: 'Invalid URL: missing hostname' }
  }

  return { ok: true, href: url.href, hostname: url.hostname }
}

export default parseFetchUrl
