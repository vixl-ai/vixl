<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import ChatPromptInput from '@/components/chat/ChatPromptInput.vue'
import useChatStore from '@/composables/use-chat-store'
import useFleetRegistry from '@/composables/use-fleet-registry'
import { refreshFleetSidebar } from '@/composables/use-fleet-sidebar'
import { setPendingChatMessage } from '@/services/chat/pending-message'
import { getUserHomeDir } from '@/services/vixl/vixl-tauri'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'
import chatRouteFor from '@/utils/chat-route-for'
import type { FileUIPart } from 'ai'
import type { ContextMention } from '@/types/harness/context-mention'
import type { PermissionLevel } from '@/types/harness/permission'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import type { ReasoningLevel } from '@/types/models/reasoning-level'

const router = useRouter()
const fleet = useFleetRegistry()
const chatStore = useChatStore()
const sending = ref(false)

onMounted(() => {
  chatStore.clearChatState()
})

const handleSubmit = async (payload: {
  text: string
  mode: VixlChatMode
  model: string
  reasoning?: ReasoningLevel
  projectId: string | null
  permissionLevel: PermissionLevel
  files?: FileUIPart[]
  mentions?: ContextMention[]
}): Promise<void> => {
  sending.value = true
  try {
    if (payload.projectId) {
      await fleet.setActiveProject(payload.projectId)
    }

    const project = payload.projectId
      ? fleet.projects.value.find((item) => item.id === payload.projectId) ?? null
      : null

    const chat = project
      ? await chatStore.createNewChat({
          projectSlug: project.slug,
          projectRoot: project.rootPath,
          mode: payload.mode,
          model: payload.model,
        })
      : await chatStore.createNewChat({
          projectSlug: HOME_CHAT_SLUG,
          projectRoot: await getUserHomeDir(),
          mode: payload.mode,
          model: payload.model,
        })

    setPendingChatMessage({
      text: payload.text,
      mode: payload.mode,
      model: payload.model,
      permissionLevel: payload.permissionLevel,
      ...(payload.reasoning ? { reasoning: payload.reasoning } : {}),
      ...(payload.files && payload.files.length > 0 ? { files: payload.files } : {}),
      ...(payload.mentions && payload.mentions.length > 0
        ? { mentions: payload.mentions }
        : {}),
    })
    await refreshFleetSidebar()
    await router.push(chatRouteFor(chat.projectSlug, chat.id))
  } catch (error) {
    toast.error('Could not start chat', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col items-center justify-end px-4 pb-4 pt-2"
    @contextmenu.prevent
  >
    <div class="mx-auto flex w-full max-w-3xl flex-col">
      <ChatPromptInput
        show-project-select
        :disabled="sending"
        @submit="handleSubmit"
      />
    </div>
  </div>
</template>
