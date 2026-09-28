import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import useChatStore from '@/composables/use-chat-store'
import useVixlConfig from '@/composables/use-vixl-config'
import { refreshFleetSidebar } from '@/composables/use-fleet-sidebar'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'
import resolveModelForRole from '@/services/models/resolve-model-for-role'
import { getUserHomeDir } from '@/services/vixl/vixl-tauri'
import chatRouteFor from '@/utils/chat-route-for'

const startingChat = ref(false)

export default () => {
  const router = useRouter()
  const chatStore = useChatStore()
  const config = useVixlConfig()

  const startHomeChat = async (): Promise<void> => {
    if (startingChat.value) {
      return
    }

    startingChat.value = true
    try {
      const model = resolveModelForRole('agent', config.effectiveSettings.value) ?? ''
      if (!model) {
        toast.error('Select a default model in Settings before starting a chat')
        return
      }
      const chat = await chatStore.createNewChat({
        projectSlug: HOME_CHAT_SLUG,
        projectRoot: await getUserHomeDir(),
        mode: 'agent',
        model,
      })
      await refreshFleetSidebar()
      await router.push(chatRouteFor(HOME_CHAT_SLUG, chat.id))
    } catch (error) {
      toast.error('Could not start chat', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      startingChat.value = false
    }
  }

  return {
    startingChat,
    startHomeChat,
  }
}
