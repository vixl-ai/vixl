import type { MaybeRefOrGetter } from 'vue'
import type { ChatStackId } from '@/types/chat/chat-stack-id'

type ChatStackPillsOptions = {
  subagents: MaybeRefOrGetter<number>
  approvals: MaybeRefOrGetter<number>
  terminals: MaybeRefOrGetter<number>
  queue: MaybeRefOrGetter<number>
  todos: MaybeRefOrGetter<number>
  resetKey: MaybeRefOrGetter<string>
}

// Fixed left-to-right pill order. Counts hydrate from different async sources
// (shell registry sync, session paint, harness attach), so pill position must
// not depend on which one resolves first. Returning to a chat shows the same
// layout, and a pill whose count returns re-enters at its own slot.
const STACK_IDS: ChatStackId[] = [
  'subagents',
  'approvals',
  'terminals',
  'queue',
  'todos',
]

const readCount = (
  sources: ChatStackPillsOptions,
  id: ChatStackId,
): number => toValue(sources[id])

export default (options: ChatStackPillsOptions) => {
  const openStack = ref<ChatStackId | null>(null)

  const visiblePills = computed((): ChatStackId[] =>
    STACK_IDS.filter((id) => readCount(options, id) > 0),
  )

  const toggleStack = (id: ChatStackId): void => {
    openStack.value = openStack.value === id ? null : id
  }

  const resetOpenStack = (): void => {
    openStack.value = toValue(options.approvals) > 0 ? 'approvals' : null
  }

  resetOpenStack()

  watch(
    [
      () => toValue(options.subagents),
      () => toValue(options.approvals),
      () => toValue(options.terminals),
      () => toValue(options.queue),
      () => toValue(options.todos),
    ],
    () => {
      const current = openStack.value
      if (current !== null && readCount(options, current) <= 0) {
        openStack.value = null
      }
    },
  )

  watch(
    () => toValue(options.approvals),
    (next, prev) => {
      if (next > prev) {
        openStack.value = 'approvals'
      }
    },
  )

  watch(
    () => toValue(options.resetKey),
    () => {
      resetOpenStack()
    },
  )

  return {
    visiblePills,
    openStack,
    toggleStack,
  }
}
