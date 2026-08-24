import {
  computed,
  onBeforeUnmount,
  ref,
  watch,
  type Ref,
} from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import useBrowserPassthroughSuspend from '@/composables/use-browser-passthrough-suspend'
import { chatTitleForId } from '@/composables/use-fleet-sidebar'
import {
  browserRegistryRevision,
  getSessionLock,
  getSessionWaiters,
  takeControl,
} from '@/services/browser/registry'
import { listChats } from '@/services/vixl/vixl-tauri'
import type { BrowserLock } from '@/types/browser/browser-lock'
import chatRouteFor from '@/utils/chat-route-for'

const truncatedId = (id: string): string => id.slice(0, 8)

export default (args: {
  getCefSessionId: () => string | null
  cefSessionId: Ref<string | null>
}) => {
  const router = useRouter()
  const passthroughSuspend = useBrowserPassthroughSuspend()
  const resolvedOwnerTitle = ref<string | null>(null)
  let overlaySuspended = false
  let titleLookupGeneration = 0

  const activeLock = computed((): BrowserLock | null => {
    const sessionId = args.cefSessionId.value
    const lock = sessionId ? getSessionLock(sessionId) : null
    return browserRegistryRevision.value >= 0 ? lock : null
  })

  const waiterCount = computed(() => {
    const sessionId = args.cefSessionId.value
    if (!sessionId || browserRegistryRevision.value < 0) {
      return 0
    }
    return getSessionWaiters(sessionId).length
  })

  const ownerTitle = computed(() => {
    const lock = activeLock.value
    if (!lock) {
      return ''
    }
    return resolvedOwnerTitle.value || truncatedId(lock.ownerChatId)
  })

  const ownerSubagentLabel = computed(() => {
    const subagentId = activeLock.value?.ownerSubagentId
    if (!subagentId) {
      return null
    }
    return `Subagent ${truncatedId(subagentId)}`
  })

  const setOverlaySuspended = (next: boolean): void => {
    if (next === overlaySuspended) {
      return
    }
    if (next) {
      passthroughSuspend.suspend()
    } else {
      passthroughSuspend.resume()
    }
    overlaySuspended = next
  }

  const lookupOwnerTitle = async (lock: BrowserLock): Promise<void> => {
    const generation = ++titleLookupGeneration
    const fromFleet = chatTitleForId(lock.ownerChatId)
    if (fromFleet) {
      resolvedOwnerTitle.value = fromFleet
      return
    }
    try {
      const chats = await listChats(lock.workspaceId)
      if (generation !== titleLookupGeneration) {
        return
      }
      const match = chats.find((chat) => chat.id === lock.ownerChatId)
      resolvedOwnerTitle.value = match?.title || null
    } catch (error) {
      if (generation !== titleLookupGeneration) {
        return
      }
      resolvedOwnerTitle.value = null
      toast.error('Failed to load chat title', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  watch(
    activeLock,
    (lock) => {
      setOverlaySuspended(lock !== null)
      if (!lock) {
        titleLookupGeneration += 1
        resolvedOwnerTitle.value = null
        return
      }
      lookupOwnerTitle(lock).catch((error: unknown) => {
        toast.error('Failed to load chat title', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    setOverlaySuspended(false)
  })

  const handleTakeControl = (): void => {
    const sessionId = args.getCefSessionId()
    if (!sessionId) {
      toast.error('No browser session to take control of')
      return
    }
    try {
      takeControl(sessionId)
      toast.success('Took control of the browser')
    } catch (error) {
      toast.error('Failed to take control', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleOpenOwnerChat = (): void => {
    const lock = activeLock.value
    if (!lock) {
      toast.error('No locked chat to open')
      return
    }
    router
      .push(
        chatRouteFor(
          lock.workspaceId,
          lock.ownerChatId,
          lock.ownerSubagentId ?? undefined,
        ),
      )
      .catch((error: unknown) => {
        toast.error('Failed to open chat', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
  }

  return {
    activeLock,
    waiterCount,
    ownerTitle,
    ownerSubagentLabel,
    handleTakeControl,
    handleOpenOwnerChat,
  }
}
