import { computed, ref } from 'vue'
import type { UIMessage } from 'ai'
import type { ContextBudget } from '@/types/harness/context-budget'
import type { ContextBucket } from '@/types/harness/context-bucket'
import type { ContextMention } from '@/types/harness/context-mention'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import type { PrefixSnapshot } from '@/types/harness/prefix-snapshot'
import type { VixlChatMode, VixlSettings } from '@/types/vixl/vixl-settings'
import type { ActiveContextSlice } from '@/services/context/filter-messages-for-active-context'
import countContextBudget from '@/services/context/count-context-budget'
import parseModelRef from '@/utils/parse-model-ref'

export type LastStepUsage = {
  promptTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

const estimatedPromptUsed = ref(0)
const limit = ref(128_000)
const reservedOutput = ref(8192)
const safetyBuffer = ref(2000)
const estimatedFree = ref(0)
const buckets = ref<ContextBucket[]>([])
const modelId = ref('')
const pending = ref(false)
const lastStepUsage = ref<LastStepUsage | null>(null)
const boundChatId = ref<string | null>(null)

let refreshGeneration = 0

export type RefreshContextUsageInput = {
  modelId: string
  mode: VixlChatMode
  projectName: string
  projectRoot: string
  mentions?: ContextMention[]
  messages: UIMessage[]
  timeline?: ChatTimelineItem[]
  settings?: VixlSettings
  standalone?: boolean
  frozenSnapshot?: PrefixSnapshot | null
  activeContext?: ActiveContextSlice | null
  chatId?: string
}

export default () => {
  const usablePrompt = computed(() =>
    Math.max(0, limit.value - reservedOutput.value - safetyBuffer.value),
  )

  // Ring fill uses the local budget estimate. After a provider step, never show
  // less than last-step inputTokens (ground truth for what was in the window).
  const promptUsed = computed(() => {
    const estimated = estimatedPromptUsed.value
    const lastInput = lastStepUsage.value?.inputTokens ?? 0
    return Math.max(estimated, lastInput)
  })

  const free = computed(() =>
    Math.max(0, usablePrompt.value - promptUsed.value),
  )

  const used = computed(() => promptUsed.value)

  const ratio = computed(() =>
    usablePrompt.value > 0 ? promptUsed.value / usablePrompt.value : 0,
  )

  const percentUsed = computed(() => Math.round(ratio.value * 1000) / 10)

  const visibleBuckets = computed(() =>
    buckets.value.filter((bucket) => bucket.tokens > 0),
  )

  const hasLastStepUsage = computed(() => lastStepUsage.value !== null)

  const providerInputTokens = computed(
    () => lastStepUsage.value?.inputTokens ?? null,
  )

  const bindChat = (chatId: string | null): void => {
    if (boundChatId.value === chatId) {
      return
    }
    boundChatId.value = chatId
    lastStepUsage.value = null
  }

  const clearLastStepUsage = (): void => {
    lastStepUsage.value = null
  }

  const setBudget = (budget: ContextBudget, options?: { clearProviderFill?: boolean }): void => {
    estimatedPromptUsed.value = budget.promptUsed
    limit.value = budget.limit
    reservedOutput.value = budget.reservedOutput
    safetyBuffer.value = budget.safetyBuffer
    estimatedFree.value = budget.free
    buckets.value = budget.buckets
    modelId.value = budget.modelId
    if (options?.clearProviderFill) {
      lastStepUsage.value = null
    }
  }

  const setLastStepUsage = (usage: LastStepUsage): void => {
    lastStepUsage.value = usage
  }

  const refresh = async (input: RefreshContextUsageInput): Promise<void> => {
    if (input.chatId !== undefined) {
      bindChat(input.chatId)
    }

    const generation = ++refreshGeneration
    pending.value = true

    try {
      const parsed = parseModelRef(input.modelId)
      const budget = await countContextBudget({
        modelId: parsed?.modelId ?? input.modelId,
        providerId: parsed?.providerId,
        settings: input.settings,
        mode: input.mode,
        projectName: input.projectName,
        projectRoot: input.projectRoot,
        mentions: input.mentions ?? [],
        messages: input.messages,
        timeline: input.timeline,
        standalone: input.standalone,
        frozenSnapshot: input.frozenSnapshot,
        activeContext: input.activeContext,
      })

      if (generation !== refreshGeneration) {
        return
      }

      setBudget(budget)
    } finally {
      if (generation === refreshGeneration) {
        pending.value = false
      }
    }
  }

  return {
    used,
    promptUsed,
    estimatedPromptUsed,
    limit,
    reservedOutput,
    safetyBuffer,
    free,
    estimatedFree,
    usablePrompt,
    buckets,
    modelId,
    pending,
    ratio,
    percentUsed,
    visibleBuckets,
    lastStepUsage,
    hasLastStepUsage,
    providerInputTokens,
    bindChat,
    clearLastStepUsage,
    setBudget,
    setLastStepUsage,
    refresh,
  }
}
