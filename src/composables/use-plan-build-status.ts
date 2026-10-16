import { computed, readonly, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { toast } from 'vue-sonner'
import useChatStore from '@/composables/use-chat-store'
import useWorkbenchStore from '@/composables/use-workbench-store'
import type { ChatStatus } from '@/types/chat/chat-meta'

type PlanBuildStatusInput = {
  projectId: MaybeRefOrGetter<string>
  lastBuildChatId: MaybeRefOrGetter<string | null>
  lastBuildChatSlug?: MaybeRefOrGetter<string | null>
  sourceChatId: MaybeRefOrGetter<string | null>
  sourceChatSlug?: MaybeRefOrGetter<string | null>
}

const trimmedSlug = (value: MaybeRefOrGetter<string | null> | undefined): string => {
  if (!value) {
    return ''
  }
  return toValue(value)?.trim() ?? ''
}

const isChatNotFoundError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('Chat not found')

export default (input: PlanBuildStatusInput) => {
  const chatStore = useChatStore()
  const workbench = useWorkbenchStore()
  const missingChatIds = ref<string[]>([])

  const buildChatId = computed(
    () => toValue(input.lastBuildChatId) ?? toValue(input.sourceChatId),
  )

  const tabProjectSlug = computed(
    () => workbench.getProject(toValue(input.projectId))?.slug ?? null,
  )

  const buildChatSlug = computed((): string | null => {
    const id = buildChatId.value
    const lastBuildId = toValue(input.lastBuildChatId)
    const lastBuildSlug = trimmedSlug(input.lastBuildChatSlug)
    if (id && lastBuildId && id === lastBuildId && lastBuildSlug) {
      return lastBuildSlug
    }
    const sourceId = toValue(input.sourceChatId)
    const sourceSlug = trimmedSlug(input.sourceChatSlug)
    if (id && sourceId && id === sourceId && sourceSlug) {
      return sourceSlug
    }
    return tabProjectSlug.value
  })

  const buildChatStatus = computed((): ChatStatus => {
    const id = buildChatId.value
    const slug = buildChatSlug.value
    if (!id || !slug) {
      return 'idle'
    }
    return chatStore.forChat(slug, id).meta.value?.status ?? 'idle'
  })

  const buildChatMissing = computed(() => {
    const id = buildChatId.value
    return Boolean(id && missingChatIds.value.includes(id))
  })

  const markChatMissing = (id: string): void => {
    if (missingChatIds.value.includes(id)) {
      return
    }
    missingChatIds.value = [...missingChatIds.value, id]
  }

  const markChatPresent = (id: string): void => {
    if (!missingChatIds.value.includes(id)) {
      return
    }
    missingChatIds.value = missingChatIds.value.filter((item) => item !== id)
  }

  watch(
    [buildChatId, buildChatSlug],
    async ([id, slug]) => {
      if (!id || !slug) {
        return
      }
      try {
        await chatStore.refreshChatMeta(slug, id)
        markChatPresent(id)
      } catch (error) {
        if (isChatNotFoundError(error)) {
          markChatMissing(id)
          return
        }
        toast.error('Failed to load plan build status', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    { immediate: true },
  )

  return {
    buildChatId,
    buildChatStatus,
    buildChatMissing,
    missingChatIds: readonly(missingChatIds),
  }
}
