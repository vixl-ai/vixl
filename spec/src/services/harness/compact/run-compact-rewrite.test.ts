import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanguageModel, ModelMessage, ToolSet } from 'ai'
import type { ModelRef } from '@/types/models/model-ref'
import { estimatePromptTokens } from '@/services/harness/compact'

const generateCheckpoint = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)

vi.mock('@/services/harness/compact/generate-checkpoint', () => ({
  default: (...args: unknown[]) => generateCheckpoint(...args),
}))

import runCompactRewrite from '@/services/harness/compact/run-compact-rewrite'

const model = { id: 'chat-model' } as unknown as LanguageModel
const modelRef: ModelRef = { providerId: 'local', modelId: 'qwen' }
const tools: ToolSet = {}
const hugeContent = 'x'.repeat(800_000)
const system = 'You are the parent agent.'
const highWater = 20_000

const checkpointInput = (messages: ModelMessage[], signal = new AbortController().signal) => ({
  model,
  modelRef,
  system,
  providerOptions: {},
  tools,
  messages,
  focus: 'parent',
  signal,
})

describe('runCompactRewrite', () => {
  beforeEach(() => {
    generateCheckpoint.mockReset()
  })

  it('returns the model summary when generation succeeds and the rewrite fits', async () => {
    generateCheckpoint.mockResolvedValue({
      summary: 'Short recap',
      usage: { inputTokens: 2, outputTokens: 1 },
      providerMetadata: undefined,
      responseId: 'r1',
      modelRef,
    })
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Find the auth bug.' },
      { role: 'assistant', content: hugeContent },
    ]

    const result = await runCompactRewrite({
      checkpointInput: checkpointInput(messages),
      system,
      messages,
      highWater,
    })

    expect(result.summary).toBe('Short recap')
    expect(result.compacted?.responseId).toBe('r1')
    expect(estimatePromptTokens(system, result.messages)).toBeLessThanOrEqual(
      highWater,
    )
  })

  it('falls back when checkpoint generation fails', async () => {
    generateCheckpoint.mockRejectedValue(new Error('prompt is too long'))
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Find the auth bug.' },
      { role: 'assistant', content: hugeContent },
    ]

    const result = await runCompactRewrite({
      checkpointInput: checkpointInput(messages),
      system,
      messages,
      highWater,
    })

    expect(result.compacted).toBeNull()
    expect(result.summary).toContain('Deterministic compaction fallback')
    expect(estimatePromptTokens(system, result.messages)).toBeLessThanOrEqual(
      highWater,
    )
  })

  it('keeps the paid checkpoint when a huge model summary overflows and fallback persists', async () => {
    generateCheckpoint.mockResolvedValue({
      summary: 'M'.repeat(800_000),
      usage: { inputTokens: 40, outputTokens: 20 },
      providerMetadata: { paid: true },
      responseId: 'r-paid',
      modelRef,
    })
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Find the auth bug.' },
      { role: 'assistant', content: 'Inspecting token refresh.' },
    ]

    const result = await runCompactRewrite({
      checkpointInput: checkpointInput(messages),
      system,
      messages,
      highWater,
    })

    expect(result.summary).toContain('Deterministic compaction fallback')
    expect(result.compacted?.responseId).toBe('r-paid')
    expect(result.compacted?.usage).toEqual({
      inputTokens: 40,
      outputTokens: 20,
    })
    expect(estimatePromptTokens(system, result.messages)).toBeLessThanOrEqual(
      highWater,
    )
  })

  it('skips a doomed checkpoint request when the prompt is already over the hard window', async () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: hugeContent },
    ]

    const result = await runCompactRewrite({
      checkpointInput: checkpointInput(messages),
      system,
      messages,
      highWater,
      hardWindow: 1_000,
    })

    expect(generateCheckpoint).not.toHaveBeenCalled()
    expect(result.compacted).toBeNull()
    expect(result.summary).toContain('Deterministic compaction fallback')
    expect(estimatePromptTokens(system, result.messages)).toBeLessThanOrEqual(
      highWater,
    )
  })

  it('rethrows aborted checkpoint generation', async () => {
    const controller = new AbortController()
    generateCheckpoint.mockImplementation(async () => {
      controller.abort()
      throw new Error('aborted')
    })
    const messages: ModelMessage[] = [
      { role: 'assistant', content: hugeContent },
    ]

    await expect(
      runCompactRewrite({
        checkpointInput: checkpointInput(messages, controller.signal),
        system,
        messages,
        highWater,
      }),
    ).rejects.toThrow('aborted')
  })
})
