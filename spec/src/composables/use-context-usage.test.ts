import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContextBudget } from '@/types/harness/context-budget'
import type { RefreshContextUsageInput } from '@/composables/use-context-usage'

const countContextBudget = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<ContextBudget>>(),
)

vi.mock('@/services/context/count-context-budget', () => ({
  default: (...args: unknown[]) => countContextBudget(...args),
}))

const sampleBudget = (promptUsed: number): ContextBudget => ({
  modelId: 'test-model',
  limit: 262_000,
  promptUsed,
  reservedOutput: 33_000,
  safetyBuffer: 2_000,
  free: Math.max(0, 262_000 - 33_000 - 2_000 - promptUsed),
  used: promptUsed,
  buckets: [
    {
      id: 'messages',
      label: 'Conversation',
      tokens: promptUsed,
    },
  ],
})

const filledLastStep = {
  promptTokens: 51_000,
  inputTokens: 51_000,
  outputTokens: 1_200,
  cacheReadTokens: 47_000,
  cacheWriteTokens: 0,
}

const refreshInput = (
  chatId: string | undefined,
): RefreshContextUsageInput => ({
  modelId: 'test-model',
  mode: 'agent',
  projectName: 'Demo',
  projectRoot: '/tmp/demo',
  messages: [],
  chatId,
})

describe('useContextUsage', () => {
  beforeEach(() => {
    vi.resetModules()
    countContextBudget.mockReset()
    countContextBudget.mockResolvedValue(sampleBudget(8_000))
  })

  it('keeps ring fill on the budget estimate after last-step usage', async () => {
    const { default: useContextUsage } = await import(
      '@/composables/use-context-usage'
    )
    const contextUsage = useContextUsage()

    contextUsage.setBudget(sampleBudget(167_000))
    expect(contextUsage.promptUsed.value).toBe(167_000)
    expect(contextUsage.free.value).toBe(60_000)
    expect(contextUsage.ratio.value).toBeCloseTo(167_000 / 227_000)

    contextUsage.setLastStepUsage({
      promptTokens: 20_000,
      inputTokens: 20_000,
      outputTokens: 37,
      cacheReadTokens: 20_000,
      cacheWriteTokens: 0,
    })

    // Last-step input is lower than the estimate: keep the estimate (no snap-down).
    expect(contextUsage.promptUsed.value).toBe(167_000)
    expect(contextUsage.free.value).toBe(60_000)
    expect(contextUsage.ratio.value).toBeCloseTo(167_000 / 227_000)
    expect(contextUsage.lastStepUsage.value?.inputTokens).toBe(20_000)
    expect(contextUsage.hasLastStepUsage.value).toBe(true)
  })

  it('floors ring fill to last-step input when the estimate undercounts', async () => {
    const { default: useContextUsage } = await import(
      '@/composables/use-context-usage'
    )
    const contextUsage = useContextUsage()

    contextUsage.setBudget(sampleBudget(5_000))
    contextUsage.setLastStepUsage({
      promptTokens: 51_000,
      inputTokens: 51_000,
      outputTokens: 1_200,
      cacheReadTokens: 47_000,
      cacheWriteTokens: 0,
    })

    expect(contextUsage.promptUsed.value).toBe(51_000)
    expect(contextUsage.free.value).toBe(227_000 - 51_000)
  })

  it('clears last-step footer state when setBudget clears provider fill', async () => {
    const { default: useContextUsage } = await import(
      '@/composables/use-context-usage'
    )
    const contextUsage = useContextUsage()

    contextUsage.setBudget(sampleBudget(167_000))
    contextUsage.setLastStepUsage({
      promptTokens: 20_000,
      inputTokens: 20_000,
      outputTokens: 37,
      cacheReadTokens: 20_000,
      cacheWriteTokens: 0,
    })

    contextUsage.setBudget(sampleBudget(170_000), { clearProviderFill: true })

    expect(contextUsage.promptUsed.value).toBe(170_000)
    expect(contextUsage.lastStepUsage.value).toBeNull()
    expect(contextUsage.hasLastStepUsage.value).toBe(false)
  })

  it('clears last-step usage and visible fill when the bound chat becomes null', async () => {
    const { default: useContextUsage } = await import(
      '@/composables/use-context-usage'
    )
    const contextUsage = useContextUsage()

    contextUsage.bindChat('chat-a')
    contextUsage.setBudget(sampleBudget(5_000))
    contextUsage.setLastStepUsage(filledLastStep)
    expect(contextUsage.promptUsed.value).toBe(51_000)

    contextUsage.bindChat(null)

    expect(contextUsage.lastStepUsage.value).toBeNull()
    expect(contextUsage.hasLastStepUsage.value).toBe(false)
    expect(contextUsage.promptUsed.value).toBe(0)
    expect(contextUsage.estimatedPromptUsed.value).toBe(0)
    expect(contextUsage.visibleBuckets.value).toEqual([])
  })

  it('does not floor a new chat to the previous chat last-step usage', async () => {
    countContextBudget.mockResolvedValue(sampleBudget(8_000))
    const { default: useContextUsage } = await import(
      '@/composables/use-context-usage'
    )
    const contextUsage = useContextUsage()

    contextUsage.bindChat('chat-old')
    contextUsage.setBudget(sampleBudget(5_000))
    contextUsage.setLastStepUsage(filledLastStep)
    expect(contextUsage.promptUsed.value).toBe(51_000)

    await contextUsage.refresh(refreshInput('chat-new'))

    expect(contextUsage.lastStepUsage.value).toBeNull()
    expect(contextUsage.promptUsed.value).toBe(8_000)
  })

  it('clears fill when refresh has no chatId after a bound chat', async () => {
    countContextBudget.mockResolvedValue(sampleBudget(8_000))
    const { default: useContextUsage } = await import(
      '@/composables/use-context-usage'
    )
    const contextUsage = useContextUsage()

    contextUsage.bindChat('chat-old')
    contextUsage.setBudget(sampleBudget(5_000))
    contextUsage.setLastStepUsage(filledLastStep)

    await contextUsage.refresh(refreshInput(undefined))

    expect(contextUsage.lastStepUsage.value).toBeNull()
    expect(contextUsage.promptUsed.value).toBe(8_000)
  })

  it('discards an in-flight refresh after bindChat to another chat', async () => {
    let resolveBudget: ((budget: ContextBudget) => void) | undefined
    countContextBudget.mockImplementation(
      () =>
        new Promise<ContextBudget>((resolve) => {
          resolveBudget = resolve
        }),
    )
    const { default: useContextUsage } = await import(
      '@/composables/use-context-usage'
    )
    const contextUsage = useContextUsage()

    const pendingRefresh = contextUsage.refresh(refreshInput('chat-a'))
    contextUsage.bindChat('chat-b')
    expect(contextUsage.promptUsed.value).toBe(0)

    resolveBudget?.(sampleBudget(99_000))
    await pendingRefresh

    expect(contextUsage.promptUsed.value).toBe(0)
    expect(contextUsage.lastStepUsage.value).toBeNull()
  })
})
