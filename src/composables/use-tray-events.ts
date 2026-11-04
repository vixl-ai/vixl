import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauri } from '@/services/vixl/vixl-tauri'
import type { TrayOpenChatPayload } from '@/types/tray/tray-open-chat-payload'
import chatRouteFor from '@/utils/chat-route-for'

const reportNavigationFailure = (error: unknown): void => {
  toast.error('Navigation failed', {
    description: error instanceof Error ? error.message : 'Unknown error',
  })
}

export default (): void => {
  const router = useRouter()
  let cancelled = false
  let unlistenOpenChat: UnlistenFn | null = null
  let unlistenNewAgent: UnlistenFn | null = null

  const subscribe = async (): Promise<void> => {
    if (!isTauri()) {
      return
    }

    const openChat = await listen<TrayOpenChatPayload>('vixl-tray-open-chat', (event) => {
      router
        .push(chatRouteFor(event.payload.projectSlug, event.payload.chatId))
        .catch(reportNavigationFailure)
    })
    if (cancelled) {
      openChat()
      return
    }
    unlistenOpenChat = openChat

    const newAgent = await listen('vixl-tray-new-agent', () => {
      router.push('/').catch(reportNavigationFailure)
    })
    if (cancelled) {
      newAgent()
      return
    }
    unlistenNewAgent = newAgent
  }

  onMounted(async () => {
    await subscribe()
  })

  onUnmounted(() => {
    cancelled = true
    unlistenOpenChat?.()
    unlistenNewAgent?.()
    unlistenOpenChat = null
    unlistenNewAgent = null
  })
}
