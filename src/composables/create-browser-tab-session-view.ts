import { toast } from 'vue-sonner'
import {
  browserCefDestroy,
  browserCefResize,
} from '@/services/vixl/vixl-tauri/browser'
import { unregisterCefSession } from '@/services/browser/registry'
import type { CefBounds } from '@/types/browser/cef-bounds'
import readBrowserHostBounds from '@/utils/browser-host-bounds'
import { BROWSER_HIDDEN_BOUNDS } from '@/utils/browser-session-storage'
import invokeErrorMessage from '@/utils/invoke-error-message'
import syncBrowserPassthroughRects from '@/utils/sync-browser-passthrough-rects'

const isUnknownCefSessionError = (error: unknown): boolean =>
  invokeErrorMessage(error).includes('unknown CEF session')

const clearPassthrough = async (): Promise<void> => {
  await syncBrowserPassthroughRects({
    enabled: false,
    hostEl: null,
    lastBounds: null,
  })
}

type ViewOpsArgs = {
  getSessionId: () => string | null
  isCreated: () => boolean
  isTabActive: () => boolean
  getHostEl: () => HTMLElement | null
  getLastBounds: () => CefBounds | null
  setLastBounds: (bounds: CefBounds) => void
  clearSessionId: () => void
  setSessionId: (sessionId: string) => void
  setCreated: (value: boolean) => void
  setCefReady: (value: boolean) => void
  stopPolling: () => void
  syncPassthroughRects: () => Promise<void>
}

export default (args: ViewOpsArgs) => {
  const switchToSession = async (sessionId: string): Promise<void> => {
    const prev = args.getSessionId()
    if (prev && prev !== sessionId) {
      try {
        await browserCefResize(prev, BROWSER_HIDDEN_BOUNDS)
      } catch (error) {
        if (!isUnknownCefSessionError(error)) {
          toast.error('Failed to hide previous page', {
            description: invokeErrorMessage(error),
          })
        }
      }
    }
    args.setSessionId(sessionId)
    args.setCreated(true)
    args.setCefReady(true)
  }

  const hideCefView = async (): Promise<void> => {
    const sessionId = args.getSessionId()
    if (!sessionId) {
      await clearPassthrough()
      return
    }
    try {
      await browserCefResize(sessionId, BROWSER_HIDDEN_BOUNDS)
    } catch (error) {
      if (!isUnknownCefSessionError(error)) {
        toast.error('Failed to hide browser view', {
          description: invokeErrorMessage(error),
        })
      }
    } finally {
      // Clear independently of resize so a failed browserCefResize cannot leave
      // a passthrough hole (sidebar drag would stop working).
      await clearPassthrough()
    }
  }

  const showCefView = async (): Promise<void> => {
    const sessionId = args.getSessionId()
    if (!args.isCreated() || !sessionId) {
      return
    }
    if (!args.isTabActive()) {
      await hideCefView()
      return
    }
    const bounds = readBrowserHostBounds(args.getHostEl()) ?? args.getLastBounds()
    if (!bounds) {
      return
    }
    args.setLastBounds(bounds)
    try {
      await browserCefResize(sessionId, bounds)
      await args.syncPassthroughRects()
    } catch (error) {
      toast.error('Failed to show browser view', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const resizeToHost = async (): Promise<void> => {
    const sessionId = args.getSessionId()
    if (!sessionId || !args.isTabActive()) {
      return
    }
    const bounds = readBrowserHostBounds(args.getHostEl())
    if (!bounds) {
      return
    }
    args.setLastBounds(bounds)
    try {
      await browserCefResize(sessionId, bounds)
      await args.syncPassthroughRects()
    } catch (error) {
      if (!isUnknownCefSessionError(error)) {
        toast.error('Failed to resize browser', {
          description: invokeErrorMessage(error),
        })
      }
    }
  }

  const detachActiveSession = async (): Promise<void> => {
    args.stopPolling()
    args.clearSessionId()
    args.setCreated(false)
    args.setCefReady(false)
    await hideCefView()
  }

  const destroyCefSession = async (): Promise<void> => {
    args.stopPolling()
    const sessionId = args.getSessionId()
    args.clearSessionId()
    args.setCreated(false)
    args.setCefReady(false)
    await clearPassthrough()
    if (!sessionId) {
      return
    }
    unregisterCefSession(sessionId)
    try {
      await browserCefDestroy(sessionId)
    } catch (error) {
      toast.error('Failed to destroy browser view', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const closeCefView = async (): Promise<void> => {
    args.stopPolling()
    try {
      await hideCefView()
    } catch (error) {
      toast.error('Failed to close browser view', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return {
    hideCefView,
    showCefView,
    resizeToHost,
    detachActiveSession,
    destroyCefSession,
    closeCefView,
    switchToSession,
  }
}
