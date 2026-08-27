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
const persistCompactionCheckpoint = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
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

vi.mock('@/services/harness/compact/persist-checkpoint', () => ({
  default: (...args: unknown[]) => persistCompactionCheckpoint(...args),
}))

vi.mock('@/services/billing/capture-billable-usage', () => ({
  default: (...args: unknown[]) => captureBillableUsage(...args),
}))

import prepareParentCompactStep from '@/services/harness/orchestrator/prepare-compact-step'

const parentModelRef: ModelRef = {
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
  summary: 'Parent recap of the debugging so far.',
  usage: { inputTokens: 12, outputTokens: 5 },
  providerMetadata: { test: true },
  responseId: 'resp-compact-parent',
  modelRef: { providerId: 'openai', modelId: 'gpt-4o' },
}

const baseInput = () => {
  const onEvent = vi.fn<(event: HarnessEvent) => void>()
  return {
    onEvent,
    input: {
      settings,
      modelRef: parentModelRef,
      system: 'You are the parent agent.',
      signal: new AbortController().signal,
      projectSlug: 'demo',
      chatId: 'chat-1',
      turnId: 'turn-1',
      messages: [],
      onEvent,
    },
  }
}

describe('prepareParentCompactStep', () => {
  beforeEach(() => {
    summarizeTranscript.mockReset()
    rewriteModelMessages.mockReset()
    persistCompactionCheckpoint.mockReset()
    captureBillableUsage.mockReset()
    summarizeTranscript.mockResolvedValue(compactedResult)
    rewriteModelMessages.mockReturnValue([
      { role: 'user', content: 'rewritten' },
    ])
    persistCompactionCheckpoint.mockResolvedValue({
      summary: compactedResult.summary,
      includeFromCreatedAt: '2026-01-01T00:00:00.000Z',
      checkpointLineId: 'cp-parent',
    })
    captureBillableUsage.mockResolvedValue(undefined)
  })

  it('returns undefined under high-water and does not persist', async () => {
    const { onEvent, input } = baseInput()
    const prepareStep = prepareParentCompactStep(input)

    const result = await prepareStep({
      messages: [{ role: 'user', content: 'short task' }],
    })

    expect(result).toBeUndefined()
    expect(summarizeTranscript).not.toHaveBeenCalled()
    expect(persistCompactionCheckpoint).not.toHaveBeenCalled()
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('compacts over high-water, persists a checkpoint, and rewrites messages', async () => {
    const { onEvent, input } = baseInput()
    const prepareStep = prepareParentCompactStep(input)
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Find the auth bug.' },
      { role: 'assistant', content: hugeContent },
    ]

    const result = await prepareStep({ messages })

    expect(summarizeTranscript).toHaveBeenCalledTimes(1)
    const summarizeArg = summarizeTranscript.mock.calls[0]?.[0] as {
      transcript: string
      focus: string
    }
    expect(summarizeArg.focus).toBe('parent')
    expect(summarizeArg.transcript.length).toBeLessThanOrEqual(
      compactBudgets.TRANSCRIPT_TOKEN_BUDGET * 4,
    )
    expect(persistCompactionCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        projectSlug: 'demo',
        chatId: 'chat-1',
        summary: compactedResult.summary,
        focus: 'parent',
      }),
    )
    expect(onEvent).toHaveBeenCalledWith({
      type: 'compaction',
      summary: compactedResult.summary,
      focus: 'parent',
    })
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'chat-meta-changed',
        patch: expect.objectContaining({
          activeContext: expect.objectContaining({
            checkpointLineId: 'cp-parent',
            summary: compactedResult.summary,
          }),
        }),
      }),
    )
    expect(result).toEqual({
      messages: [{ role: 'user', content: 'rewritten' }],
    })
  })
})
