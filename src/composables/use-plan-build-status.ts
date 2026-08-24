import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import useChatStore from '@/composables/use-chat-store'
import useWorkbenchStore from '@/composables/use-workbench-store'
import type { ChatStatus } from '@/types/chat/chat-meta'

type PlanBuildStatusInput = {
  projectId: MaybeRefOrGetter<string>
  lastBuildChatId: MaybeRefOrGetter<string | null>
  sourceChatId: MaybeRefOrGetter<string | null>
}

export default (input: PlanBuildStatusInput) => {
  const chatStore = useChatStore()
  const workbench = useWorkbenchStore()

  const buildChatId = computed(
    () => toValue(input.lastBuildChatId) ?? toValue(input.sourceChatId),
  )

  const projectSlug = computed(
    () => workbench.getProject(toValue(input.projectId))?.slug ?? null,
  )

  const buildChatStatus = computed((): ChatStatus => {
    const id = buildChatId.value
    const slug = projectSlug.value
    if (!id || !slug) {
      return 'idle'
    }
    return chatStore.forChat(slug, id).meta.value?.status ?? 'idle'
  })

  return {
    buildChatId,
    buildChatStatus,
  }
}
