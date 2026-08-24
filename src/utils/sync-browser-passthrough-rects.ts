import { toast } from 'vue-sonner'
import { browserCefSetPassthroughRects } from '@/services/vixl/vixl-tauri/browser'
import type { CefBounds } from '@/types/browser/cef-bounds'
import readBrowserHostBounds from '@/utils/browser-host-bounds'

type SyncBrowserPassthroughRectsArgs = {
  enabled: boolean
  hostEl: HTMLElement | null
  // Kept for call-site compatibility; never used as a fallback for a zero-size host.
  lastBounds: CefBounds | null
}

let passthroughGeneration = 0
let passthroughWriteChain: Promise<void> = Promise.resolve()

const syncBrowserPassthroughRects = async (
  args: SyncBrowserPassthroughRectsArgs,
): Promise<void> => {
  const generation = ++passthroughGeneration
  // Live host bounds only. A zero-size (v-show:false) host must clear the hole,
  // never republish a stale lastBounds rect.
  const bounds = args.enabled ? readBrowserHostBounds(args.hostEl) : null
  const rects = bounds ? [bounds] : []

  const apply = async (): Promise<void> => {
    // Last-writer-wins: skip applying if a newer sync started before we reach IPC.
    if (generation !== passthroughGeneration) {
      return
    }
    try {
      await browserCefSetPassthroughRects(rects)
      if (generation !== passthroughGeneration) {
        return
      }
    } catch (error) {
      if (generation !== passthroughGeneration) {
        return
      }
      toast.error('Failed to update browser click targets', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  // Serialize applies inside this util so an older in-flight enabled sync cannot
  // publish after a later clear. Call sites stay fire-and-forget; no mutex there.
  const next = passthroughWriteChain.then(apply, apply)
  passthroughWriteChain = next.then(
    () => undefined,
    () => undefined,
  )
  await next
}

export default syncBrowserPassthroughRects
