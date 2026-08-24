import CdpClient from '@/services/browser/cdp-client'
import { browserCefGetCdpWsUrl } from '@/services/vixl/vixl-tauri/browser'

const clients = new Map<string, CdpClient>()
const inflight = new Map<string, Promise<CdpClient>>()

/**
 * Resolve a CDP client for a CEF session's page-target WebSocket.
 */
const resolveCefCdpClient = async (sessionId: string): Promise<CdpClient> => {
  const trimmed = sessionId.trim()
  if (!trimmed) {
    throw new Error('CEF session id is required')
  }

  const existing = clients.get(trimmed)
  if (existing) {
    return existing
  }

  const pending = inflight.get(trimmed)
  if (pending) {
    return pending
  }

  const promise = (async (): Promise<CdpClient> => {
    // Background CEF claim fills cdp_ws_url off the main thread; retry briefly.
    const deadline = Date.now() + 10_000
    let wsUrl: string | null = null
    let lastError: unknown = null
    while (Date.now() < deadline) {
      try {
        wsUrl = await browserCefGetCdpWsUrl(trimmed)
        break
      } catch (error) {
        lastError = error
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes('not ready yet')) {
          throw error
        }
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 50)
        })
      }
    }
    if (!wsUrl) {
      throw lastError instanceof Error
        ? lastError
        : new Error(`CDP target not ready yet for session ${trimmed}`)
    }
    const client = await CdpClient.connectWsUrl(wsUrl)
    clients.set(trimmed, client)
    return client
  })().finally(() => {
    inflight.delete(trimmed)
  })

  inflight.set(trimmed, promise)
  return promise
}

const dropCefCdpClient = (sessionId: string): void => {
  const client = clients.get(sessionId)
  if (!client) {
    return
  }
  clients.delete(sessionId)
  client.close()
}

const resetCefCdpClientsForTests = (): void => {
  for (const client of clients.values()) {
    client.close()
  }
  clients.clear()
  inflight.clear()
}

export { dropCefCdpClient, resetCefCdpClientsForTests }
export default resolveCefCdpClient
