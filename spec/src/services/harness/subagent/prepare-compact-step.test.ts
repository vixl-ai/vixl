import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelMessage } from 'ai'
import type { ModelRef } from '@/types/models/model-ref'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessEvent } from '@/types/harness/harness-event'
import { compactBudgets } from '@/services/harness/compact'

const summarizeTranscript = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)
const rewriteModelMessages = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => ModelMessage[]>(),
)
const captureBillableUsage = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(),
)

vi.mock('@/services/harness/compact/summarize-transcript', () => ({
  default: (...args: unknown[]) => summarizeTranscript(...args),
}))

vi.mock('@/services/harness/compact/rewrite-model-messages', () => ({
  default: (...args: unknown[]) => rewriteModelMessages(...args),
}))

vi.mock('@/services/billing/capture-billable-usage', () => ({
  default: (...args: unknown[]) => captureBillableUsage(...args),
}))

import prepareCompactStep from '@/services/harness/subagent/prepare-compact-step'

const childModelRef: ModelRef = {
  providerId: 'local',
  modelId: 'qwen',
}

const settings = {
  version: 1,
  'models.default': 'local::qwen',
  'providers.custom.local': {
    type: 'openai-compatible',
    name: 'Local',
    baseURL: 'http://127.0.0.1:11434/v1',
    models: [{ id: 'qwen', contextWindow: 262144 }],
  },
} as VixlSettings

const hugeContent = 'x'.repeat(800_000)

const compactedResult = {
  summary: 'Subagent found the auth bug.',
  usage: { inputTokens: 12, outputTokens: 5 },
  providerMetadata: { test: true },
  responseId: 'resp-compact-1',
  modelRef: { providerId: 'openai', modelId: 'gpt-4o' },
}

const baseInput = () => {
  const emitNestedEvent = vi.fn<(event: HarnessEvent) => void>()
  const onBillEvent = vi.fn<(event: HarnessEvent) => void>()
  return {
    emitNestedEvent,
    onBillEvent,
    input: {
      settings,
      modelRef: childModelRef,
      system: 'You are a child subagent.',
      signal: new AbortController().signal,
      chatModel: 'local::qwen',
      projectSlug: 'demo',
      chatId: 'chat-1',
      turnId: 'turn-1',
      subagentId: 'sub-1',
      emitNestedEvent,
      onBillEvent,
    },
  }
}

describe('prepareCompactStep', () => {
  beforeEach(() => {
    summarizeTranscript.mockReset()
    rewriteModelMessages.mockReset()
    captureBillableUsage.mockReset()
    summarizeTranscript.mockResolvedValue(compactedResult)
    rewriteModelMessages.mockReturnValue([
      { role: 'user', content: 'rewritten' },
    ])
    captureBillableUsage.mockResolvedValue(undefined)
  })

  it('returns undefined under budget and does not summarize', async () => {
    const { emitNestedEvent, input } = baseInput()
    const prepareStep = prepareCompactStep(input)

    const result = await prepareStep({
      messages: [{ role: 'user', content: 'short task' }],
    })

    expect(result).toBeUndefined()
    expect(summarizeTranscript).not.toHaveBeenCalled()
    expect(rewriteModelMessages).not.toHaveBeenCalled()
    expect(captureBillableUsage).not.toHaveBeenCalled()
    expect(emitNestedEvent).not.toHaveBeenCalled()
  })

  it('summarizes once when over budget, rewrites, emits, and bills compaction', async () => {
    const { emitNestedEvent, onBillEvent, input } = baseInput()
    const prepareStep = prepareCompactStep(input)
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Spawn: find the auth bug.' },
      { role: 'assistant', content: hugeContent },
    ]

    const result = await prepareStep({ messages })

    expect(summarizeTranscript).toHaveBeenCalledTimes(1)
    const summarizeArg = summarizeTranscript.mock.calls[0]?.[0] as {
      transcript: string
      focus: string
      chatModel?: string
    }
    expect(summarizeArg.focus).toBe('subagent')
    expect(summarizeArg.chatModel).toBe('local::qwen')
    expect(summarizeArg.transcript.length).toBeLessThanOrEqual(
      compactBudgets.TRANSCRIPT_TOKEN_BUDGET * 4,
    )
    expect(summarizeArg.transcript).not.toContain(hugeContent)

    expect(rewriteModelMessages).toHaveBeenCalledWith(
      messages,
      compactedResult.summary,
    )
    expect(emitNestedEvent).toHaveBeenCalledWith({
      type: 'compaction',
      summary: compactedResult.summary,
      focus: 'subagent',
    })
    expect(captureBillableUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        projectSlug: 'demo',
        chatId: 'chat-1',
        turnId: 'turn-1',
        source: 'compaction',
        providerId: 'openai',
        modelId: 'gpt-4o',
        usage: compactedResult.usage,
        providerMetadata: compactedResult.providerMetadata,
        responseId: compactedResult.responseId,
        subagentId: 'sub-1',
        settings,
        onEvent: onBillEvent,
      }),
    )
    expect(result).toEqual({
      messages: [{ role: 'user', content: 'rewritten' }],
    })
  })

  it('throws when rewritten messages still exceed the window', async () => {
    rewriteModelMessages.mockReturnValue([
      { role: 'user', content: hugeContent },
    ])
    const { input } = baseInput()
    const prepareStep = prepareCompactStep(input)

    await expect(
      prepareStep({
        messages: [{ role: 'assistant', content: hugeContent }],
      }),
    ).rejects.toThrow(
      'Subagent context still exceeds the model window after compaction',
    )
    expect(summarizeTranscript).toHaveBeenCalledTimes(1)
    expect(captureBillableUsage).not.toHaveBeenCalled()
  })
})
