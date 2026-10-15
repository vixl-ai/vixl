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
import type { ChatPromptWorkspace } from '@/types/chat/chat-prompt-workspace'
import type { FileUIPart } from 'ai'
import type { ContextMention } from '@/types/harness/context-mention'
import type { PermissionLevel } from '@/types/harness/permission'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import chatRouteFor from '@/utils/chat-route-for'

const router = useRouter()
const fleet = useFleetRegistry()
const chatStore = useChatStore()
const sending = ref(false)

onMounted(() => {
  chatStore.clearChatState()
})

const startHomeChat = async (payload: {
  mode: VixlChatMode
  model: string
}) =>
  chatStore.createNewChat({
    projectSlug: HOME_CHAT_SLUG,
    projectRoot: await getUserHomeDir(),
    mode: payload.mode,
    model: payload.model,
  })

const startProjectChat = async (
  projectId: string,
  payload: { mode: VixlChatMode; model: string },
) => {
  await fleet.setActiveProject(projectId)
  const project = fleet.projects.value.find((item) => item.id === projectId) ?? null
  if (!project) {
    throw new Error('Project not found')
  }
  return chatStore.createNewChat({
    projectSlug: project.slug,
    projectRoot: project.rootPath,
    mode: payload.mode,
    model: payload.model,
  })
}

const startGroupChat = async (
  groupId: string,
  payload: { mode: VixlChatMode; model: string },
) => {
  const group = fleet.groups.value.find((item) => item.id === groupId) ?? null
  if (!group) {
    throw new Error('Group not found')
  }
  const primarySlug = group.memberSlugs[0]
  const primary = primarySlug
    ? fleet.projects.value.find((item) => item.slug === primarySlug) ?? null
    : null
  if (!primary) {
    throw new Error('Group has no member projects')
  }
  await fleet.setActiveProject(primary.id)
  return chatStore.createNewChat({
    projectSlug: group.slug,
    projectRoot: primary.rootPath,
    mode: payload.mode,
    model: payload.model,
  })
}

const handleSubmit = async (payload: {
  text: string
  mode: VixlChatMode
  model: string
  reasoning?: ReasoningLevel
  workspace: ChatPromptWorkspace
  permissionLevel: PermissionLevel
  files?: FileUIPart[]
  mentions?: ContextMention[]
}): Promise<void> => {
  sending.value = true
  try {
    let chat
    if (payload.workspace.kind === 'home') {
      chat = await startHomeChat(payload)
    } else if (payload.workspace.kind === 'project') {
      chat = await startProjectChat(payload.workspace.projectId, payload)
    } else if (payload.workspace.kind === 'group') {
      chat = await startGroupChat(payload.workspace.groupId, payload)
    } else {
      const memberSlugs = payload.workspace.projectIds
        .map((id) => fleet.projects.value.find((item) => item.id === id)?.slug)
        .filter((slug): slug is string => Boolean(slug))
      const group = await fleet.addGroup(memberSlugs)
      chat = await startGroupChat(group.id, payload)
    }

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
    @contextmenu.prevent.self
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
