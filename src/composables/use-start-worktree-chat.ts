import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import useChatStore from '@/composables/use-chat-store'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useVixlConfig from '@/composables/use-vixl-config'
import { refreshFleetSidebar } from '@/composables/use-fleet-sidebar'
import resolveModelForRole from '@/services/models/resolve-model-for-role'
import type { FleetSidebarProject } from '@/types/fleet/fleet-sidebar-project'
import chatRouteFor from '@/utils/chat-route-for'

export default (options: {
  project: () => Pick<FleetSidebarProject, 'id' | 'slug' | 'rootPath'>
  openRow: () => void
}) => {
  const router = useRouter()
  const fleet = useFleetRegistry()
  const chatStore = useChatStore()
  const config = useVixlConfig()
  const startingChat = ref(false)

  const startWorktreeChat = async (): Promise<void> => {
    if (startingChat.value) {
      return
    }

    const project = options.project()
    if (!project.id || !project.rootPath) {
      toast.error('Project not found')
      return
    }

    startingChat.value = true
    try {
      await fleet.setActiveProject(project.id)
      const defaultMode = 'agent' as const
      const model = resolveModelForRole(defaultMode, config.effectiveSettings.value) ?? ''
      if (!model) {
        toast.error('Select a default model in Settings before starting a chat')
        return
      }
      const chat = await chatStore.createNewChat({
        projectSlug: project.slug,
        projectRoot: project.rootPath,
        mode: defaultMode,
        model,
      })
      await refreshFleetSidebar()
      options.openRow()
      await router.push(chatRouteFor(project.slug, chat.id))
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
    startWorktreeChat,
  }
}
