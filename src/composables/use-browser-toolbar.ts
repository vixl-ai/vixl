import { ref, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import type CdpClient from '@/services/browser/cdp-client'
import {
  hardReload,
  resetNavigationHistory,
} from '@/services/browser/cdp-navigation'
import { takeScreenshot } from '@/services/browser/cdp-screenshot'
import {
  clearCacheForActiveOrigin,
  clearCookiesForActiveOrigin,
} from '@/services/browser/cdp-storage'
import saveScreenshot from '@/services/browser/screenshot-store'
import { revealInFolder } from '@/services/vixl/vixl-tauri'

type ToolbarArgs = {
  currentUrl: Ref<string>
  getCefSessionId: () => string | null
  getClient: () => Promise<CdpClient>
}

// CEF connects as a page-target CDP socket. Commands go on the socket root.
const PAGE_TARGET_CDP_SESSION_ID = ''

export default (args: ToolbarArgs) => {
  const historyUrls = ref<string[]>([])

  const recordHistoryUrl = (url: string): void => {
    const trimmed = url.trim()
    if (!trimmed || trimmed === 'about:blank') {
      return
    }
    historyUrls.value = [
      trimmed,
      ...historyUrls.value.filter((item) => item !== trimmed),
    ].slice(0, 50)
  }

  const refreshHistoryUrls = async (): Promise<void> => {
    // Local navigation memory only; embedded CEF has no CDP history list.
  }

  const requirePageTargetClient = async (): Promise<CdpClient> => {
    if (!args.getCefSessionId()) {
      throw new Error('No active browser session')
    }
    return args.getClient()
  }

  const handleTakeScreenshot = async (): Promise<void> => {
    const url = args.currentUrl.value.trim()
    if (!url || url === 'about:blank') {
      toast.error('No page to screenshot')
      return
    }
    try {
      const client = await requirePageTargetClient()
      const shot = await takeScreenshot(client, PAGE_TARGET_CDP_SESSION_ID)
      const saved = await saveScreenshot(shot.data)
      await revealInFolder(saved.path)
      toast.success('Screenshot saved', {
        description: saved.path,
      })
    } catch (error) {
      toast.error('Failed to take screenshot', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleHardReload = async (): Promise<void> => {
    try {
      const client = await requirePageTargetClient()
      await hardReload(client, PAGE_TARGET_CDP_SESSION_ID)
      toast.success('Hard reload complete')
    } catch (error) {
      toast.error('Failed to hard reload', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleCopyUrl = async (): Promise<void> => {
    const url = args.currentUrl.value.trim()
    if (!url) {
      toast.error('No URL to copy')
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      toast.success('URL copied')
    } catch (error) {
      toast.error('Failed to copy URL', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleClearBrowsingData = async (): Promise<void> => {
    try {
      const client = await requirePageTargetClient()
      await resetNavigationHistory(client, PAGE_TARGET_CDP_SESSION_ID)
      historyUrls.value = []
      toast.success('Browsing history cleared')
    } catch (error) {
      toast.error('Failed to clear browsing history', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleClearCookies = async (): Promise<void> => {
    try {
      const client = await requirePageTargetClient()
      await clearCookiesForActiveOrigin(client, PAGE_TARGET_CDP_SESSION_ID)
      toast.success('Cookies cleared')
    } catch (error) {
      toast.error('Failed to clear cookies', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleClearCache = async (): Promise<void> => {
    try {
      const client = await requirePageTargetClient()
      await clearCacheForActiveOrigin(client, PAGE_TARGET_CDP_SESSION_ID)
      toast.success('Cache cleared')
    } catch (error) {
      toast.error('Failed to clear cache', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return {
    historyUrls,
    recordHistoryUrl,
    refreshHistoryUrls,
    handleTakeScreenshot,
    handleHardReload,
    handleCopyUrl,
    handleClearBrowsingData,
    handleClearCookies,
    handleClearCache,
  }
}
