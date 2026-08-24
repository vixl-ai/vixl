import type { Ref } from 'vue'
import { toast } from 'vue-sonner'
import {
  browserCefGoBack,
  browserCefGoForward,
  browserCefNavigate,
  browserCefReload,
} from '@/services/vixl/vixl-tauri/browser'
import type { CefBounds } from '@/types/browser/cef-bounds'
import { normalizeBrowserUrl } from '@/utils/browser-tab-url'

type NavigationArgs = {
  cefReady: Ref<boolean>
  pageUrl: Ref<string>
  addressBarValue: Ref<string>
  addressInputRef: Ref<HTMLInputElement | null>
  ensureCefSession: (bounds?: CefBounds) => Promise<boolean>
  getCefSessionId: () => string | null
  markNavigated: (url: string) => void
  showCefView: () => Promise<void>
  refreshState: () => Promise<void>
  startPolling: () => void
  recordHistoryUrl: (url: string) => void
}

export default (args: NavigationArgs) => {
  const requireSessionId = async (): Promise<string | null> => {
    let sessionId = args.getCefSessionId()
    if (!args.cefReady.value || !sessionId) {
      const ok = await args.ensureCefSession()
      if (!ok) {
        return null
      }
      sessionId = args.getCefSessionId()
    }
    if (!sessionId) {
      toast.error('Browser session is not ready')
      return null
    }
    return sessionId
  }

  const handleNavigate = async (rawUrl?: string): Promise<void> => {
    const url = normalizeBrowserUrl(rawUrl ?? args.addressBarValue.value)
    if (!url) {
      return
    }
    try {
      const sessionId = await requireSessionId()
      if (!sessionId) {
        return
      }
      await browserCefNavigate(sessionId, url)
      await args.showCefView()
      args.markNavigated(url)
      args.recordHistoryUrl(url)
      await args.refreshState()
      args.startPolling()
      args.addressInputRef.value?.blur()
    } catch (error) {
      toast.error('Failed to navigate', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleBack = async (): Promise<void> => {
    try {
      const sessionId = await requireSessionId()
      if (!sessionId) {
        return
      }
      await browserCefGoBack(sessionId)
      await args.refreshState()
      if (args.pageUrl.value) {
        args.recordHistoryUrl(args.pageUrl.value)
      }
    } catch (error) {
      toast.error('Failed to go back', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleForward = async (): Promise<void> => {
    try {
      const sessionId = await requireSessionId()
      if (!sessionId) {
        return
      }
      await browserCefGoForward(sessionId)
      await args.refreshState()
      if (args.pageUrl.value) {
        args.recordHistoryUrl(args.pageUrl.value)
      }
    } catch (error) {
      toast.error('Failed to go forward', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleReload = async (): Promise<void> => {
    try {
      const sessionId = await requireSessionId()
      if (!sessionId) {
        return
      }
      await browserCefReload(sessionId)
      await args.refreshState()
    } catch (error) {
      toast.error('Failed to reload', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return {
    handleNavigate,
    handleBack,
    handleForward,
    handleReload,
  }
}
