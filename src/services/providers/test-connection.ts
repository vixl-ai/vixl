import { httpProxyRequest } from '@/services/vixl/vixl-tauri'
import {
  bearerAuth,
  resolveModelsListRequest,
} from '@/services/providers/provider-http'

export type ProviderTestInput = {
  providerId: string
  apiKey: string
  baseUrl?: string
}

const resolveAuthProbe = (input: ProviderTestInput): { url: string; headers: Record<string, string> } => {
  if (input.providerId === 'gateway') {
    return {
      url: 'https://ai-gateway.vercel.sh/v1/credits',
      headers: bearerAuth(input.apiKey),
    }
  }

  return resolveModelsListRequest(input)
}

const parseErrorMessage = (status: number, body: string): string => {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string }
      message?: string
    }
    const message = parsed.error?.message ?? parsed.message
    if (message) {
      return message
    }
  } catch {
    const trimmed = body.trim()
    if (trimmed) {
      return trimmed.slice(0, 200)
    }
    return `Request failed with status ${status}`
  }

  const trimmed = body.trim()
  if (trimmed) {
    return trimmed.slice(0, 200)
  }

  return `Request failed with status ${status}`
}

export const testProviderConnection = async (input: ProviderTestInput): Promise<string> => {
  const probe = resolveAuthProbe(input)
  const result = await httpProxyRequest({
    url: probe.url,
    method: 'GET',
    headers: probe.headers,
  })

  if (result.status >= 200 && result.status < 300) {
    return 'ok'
  }

  if (result.status === 401 || result.status === 403) {
    throw new Error('Authentication failed. Check your API key.')
  }

  throw new Error(parseErrorMessage(result.status, result.body))
}
