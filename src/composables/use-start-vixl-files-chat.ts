import { ref, type ComputedRef, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import useChatStore from '@/composables/use-chat-store'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useVixlConfig from '@/composables/use-vixl-config'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'
import resolveModelForRole from '@/services/models/resolve-model-for-role'
import type { VixlFilesKind } from '@/services/vixl/vixl-tauri'
import { getUserHomeDir } from '@/services/vixl/vixl-tauri'
import chatRouteFor from '@/utils/chat-route-for'

export default (options: {
  scope: ComputedRef<'personal' | 'project'>
  kind: Ref<VixlFilesKind>
}) => {
  const router = useRouter()
  const config = useVixlConfig()
  const fleet = useFleetRegistry()
  const chatStore = useChatStore()
  const creatingChat = ref(false)

  const handleSelectChat = async (): Promise<void> => {
    if (creatingChat.value) {
      return
    }
    creatingChat.value = true
    try {
      const model = resolveModelForRole('agent', config.effectiveSettings.value) ?? ''
      if (!model) {
        toast.error('Select a default model in Settings before starting a chat')
        return
      }
      let projectSlug: string
      let projectRoot: string
      if (options.scope.value === 'personal') {
        projectSlug = HOME_CHAT_SLUG
        projectRoot = await getUserHomeDir()
      } else {
        const fleetProject = fleet.projects.value.find(
          (p) => p.rootPath === config.activeRootPath.value,
        )
        if (!fleetProject) {
          toast.error('No active project', {
            description: 'Open a project before starting a project chat',
          })
          return
        }
        projectSlug = fleetProject.slug
        projectRoot = fleetProject.rootPath
      }
      const mode = options.kind.value === 'studio' ? 'studio' : 'plan'
      const chat = await chatStore.createNewChat({
        projectSlug,
        projectRoot,
        mode,
        model,
      })
      await router.push(chatRouteFor(projectSlug, chat.id))
    } catch (error) {
      toast.error('Could not start chat', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      creatingChat.value = false
    }
  }

  return {
    creatingChat,
    handleSelectChat,
  }
}
