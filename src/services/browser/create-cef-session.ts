import { registerCefSession } from '@/services/browser/registry'
import { browserCefCreate } from '@/services/vixl/vixl-tauri/browser'
import { BROWSER_HIDDEN_BOUNDS } from '@/utils/browser-session-storage'

const createCefSession = async (workspaceId: string): Promise<string> => {
  const sessionId = await browserCefCreate(BROWSER_HIDDEN_BOUNDS)
  registerCefSession({
    sessionId,
    workspaceId,
    url: 'about:blank',
    title: null,
  })
  return sessionId
}

export default createCefSession
