import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanguageModel, ModelMessage, ToolSet } from 'ai'
import type { ModelRef } from '@/types/models/model-ref'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessEvent } from '@/types/harness/harness-event'
import {
  compactBudgets,
  estimatePromptTokens,
  resolveCompactHighWater,
} from '@/services/harness/compact'

const generateCheckpoint = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)
const persistCompactionCheckpoint = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)
const captureBillableUsage = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(),
)

vi.mock('@/services/harness/compact/generate-checkpoint', () => ({
  default: (...args: unknown[]) => generateCheckpoint(...args),
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

const stubModel = { id: 'chat-model' } as unknown as LanguageModel
const stubTools: ToolSet = {}
const stubProviderOptions = {
  anthropic: { cacheControl: { type: 'ephemeral' } },
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

const baseInput = (overrides?: { settings?: VixlSettings; signal?: AbortSignal }) => {
  const onEvent = vi.fn<(event: HarnessEvent) => void>()
  return {
    onEvent,
    input: {
      settings: overrides?.settings ?? settings,
      model: stubModel,
      modelRef: parentModelRef,
      system: 'You are the parent agent.',
      providerOptions: stubProviderOptions,
      tools: stubTools,
      signal: overrides?.signal ?? new AbortController().signal,
      workspace: { projectSlug: 'demo', projectRoot: '/tmp/demo', projectName: 'demo' },
      chatId: 'chat-1',
      turnId: 'turn-1',
      messages: [],
      onEvent,
    },
  }
}

const expectPersistedUnderWindow = (
  system: string,
  messages: ModelMessage[],
  usedSettings: VixlSettings = settings,
) => {
  expect(estimatePromptTokens(system, messages)).toBeLessThanOrEqual(
    resolveCompactHighWater(usedSettings, parentModelRef),
  )
}

describe('prepareParentCompactStep', () => {
  beforeEach(() => {
    generateCheckpoint.mockReset()
    persistCompactionCheckpoint.mockReset()
    captureBillableUsage.mockReset()
    generateCheckpoint.mockResolvedValue(compactedResult)
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
    expect(generateCheckpoint).not.toHaveBeenCalled()
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

    expect(generateCheckpoint).toHaveBeenCalledTimes(1)
    expect(generateCheckpoint).toHaveBeenCalledWith({
      model: stubModel,
      modelRef: parentModelRef,
      system: 'You are the parent agent.',
      providerOptions: stubProviderOptions,
      tools: stubTools,
      messages,
      focus: 'parent',
      signal: input.signal,
    })
    expect(persistCompactionCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        projectSlug: 'demo',
        chatId: 'chat-1',
        summary: compactedResult.summary,
        focus: 'parent',
      }),
    )
    expect(captureBillableUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'compaction',
        providerId: compactedResult.modelRef.providerId,
        modelId: compactedResult.modelRef.modelId,
      }),
    )
    expect(onEvent).toHaveBeenCalledWith({
      type: 'compaction-started',
    })
    expect(onEvent).toHaveBeenCalledWith({
      type: 'compaction',
      summary: compactedResult.summary,
      focus: 'parent',
    })
    expect(onEvent).toHaveBeenCalledWith({ type: 'compaction-ended' })
    expect(onEvent.mock.calls[0]?.[0]).toEqual({ type: 'compaction-started' })
    expect(onEvent.mock.calls.at(-1)?.[0]).toEqual({ type: 'compaction-ended' })
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
    expect(result?.messages).toBeDefined()
    expectPersistedUnderWindow(input.system, result?.messages ?? [])
    const checkpoint = result?.messages?.[1]
    expect(
      checkpoint && 'content' in checkpoint ? checkpoint.content : '',
    ).toContain(compactBudgets.CHECKPOINT_PREFIX)
  })

  it('still rewrites when billing fails after a successful compaction', async () => {
    captureBillableUsage.mockRejectedValue(new Error('billing network failed'))
    const { onEvent, input } = baseInput()
    const prepareStep = prepareParentCompactStep(input)
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Find the auth bug.' },
      { role: 'assistant', content: hugeContent },
    ]

    const result = await prepareStep({ messages })

    expect(result?.messages).toBeDefined()
    expectPersistedUnderWindow(input.system, result?.messages ?? [])
    expect(onEvent).toHaveBeenCalledWith({ type: 'compaction-ended' })
  })

  it('bounds an oversized first user message and persists activeContext', async () => {
    const { input } = baseInput()
    const prepareStep = prepareParentCompactStep(input)
    const messages: ModelMessage[] = [{ role: 'user', content: hugeContent }]

    const result = await prepareStep({ messages })

    expect(persistCompactionCheckpoint).toHaveBeenCalledTimes(1)
    expect(captureBillableUsage).toHaveBeenCalledTimes(1)
    expect(result?.messages).toBeDefined()
    expectPersistedUnderWindow(input.system, result?.messages ?? [])
    expect(JSON.stringify(result?.messages)).not.toContain(hugeContent)
  })

  it('bounds a huge tool output and persists activeContext', async () => {
    const { input } = baseInput()
    const prepareStep = prepareParentCompactStep(input)
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Find the auth bug.' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'read_file',
            input: { path: 'login.ts' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'read_file',
            output: { type: 'text', value: hugeContent },
          },
        ],
      },
    ]

    const result = await prepareStep({ messages })

    expect(persistCompactionCheckpoint).toHaveBeenCalledTimes(1)
    expect(result?.messages).toBeDefined()
    expectPersistedUnderWindow(input.system, result?.messages ?? [])
    expect(JSON.stringify(result?.messages)).not.toContain(hugeContent)
    const rewritten = result?.messages ?? []
    const callIds = rewritten.flatMap((message) =>
      message.role === 'assistant' && Array.isArray(message.content)
        ? message.content
            .filter((part) => part.type === 'tool-call')
            .map((part) => part.toolCallId)
        : [],
    )
    const resultIds = rewritten.flatMap((message) =>
      message.role === 'tool' && Array.isArray(message.content)
        ? message.content
            .filter((part) => part.type === 'tool-result')
            .map((part) => part.toolCallId)
        : [],
    )
    expect(callIds.sort()).toEqual(resultIds.sort())
  })

  it('bills a successful checkpoint when the rewrite falls back to a deterministic summary', async () => {
    generateCheckpoint.mockResolvedValue({
      ...compactedResult,
      summary: 'M'.repeat(800_000),
    })
    const { input } = baseInput()
    const prepareStep = prepareParentCompactStep(input)
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Find the auth bug.' },
      { role: 'assistant', content: hugeContent },
    ]

    const result = await prepareStep({ messages })

    expect(persistCompactionCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.stringContaining('Deterministic compaction fallback'),
      }),
    )
    expect(captureBillableUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'compaction',
        providerId: compactedResult.modelRef.providerId,
        modelId: compactedResult.modelRef.modelId,
        responseId: compactedResult.responseId,
      }),
    )
    expect(result?.messages).toBeDefined()
    expectPersistedUnderWindow(input.system, result?.messages ?? [])
  })

  it('skips a doomed checkpoint request already over the hard window', async () => {
    const tightSettings = {
      version: 1,
      'models.default': 'local::qwen',
      'providers.custom.local': {
        type: 'openai-compatible',
        name: 'Local',
        baseURL: 'http://127.0.0.1:11434/v1',
        models: [{ id: 'qwen', contextWindow: 50_000 }],
      },
    } as VixlSettings
    const { input } = baseInput({ settings: tightSettings })
    const prepareStep = prepareParentCompactStep(input)

    const result = await prepareStep({
      messages: [{ role: 'user', content: hugeContent }],
    })

    expect(generateCheckpoint).not.toHaveBeenCalled()
    expect(captureBillableUsage).not.toHaveBeenCalled()
    expect(persistCompactionCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.stringContaining('Deterministic compaction fallback'),
      }),
    )
    expect(result?.messages).toBeDefined()
    expectPersistedUnderWindow(
      input.system,
      result?.messages ?? [],
      tightSettings,
    )
  })

  it('uses a fallback checkpoint when generation fails and still persists', async () => {
    generateCheckpoint.mockRejectedValue(new Error('prompt is too long'))
    persistCompactionCheckpoint.mockResolvedValue({
      summary: 'fallback',
      includeFromCreatedAt: '2026-01-01T00:00:00.000Z',
      checkpointLineId: 'cp-fallback',
    })
    const { onEvent, input } = baseInput()
    const prepareStep = prepareParentCompactStep(input)
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Find the auth bug.' },
      { role: 'assistant', content: hugeContent },
    ]

    const result = await prepareStep({ messages })

    expect(captureBillableUsage).not.toHaveBeenCalled()
    expect(persistCompactionCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.stringContaining('Deterministic compaction fallback'),
        focus: 'parent',
      }),
    )
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'compaction',
        focus: 'parent',
      }),
    )
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'chat-meta-changed',
        patch: expect.objectContaining({
          activeContext: expect.objectContaining({
            checkpointLineId: 'cp-fallback',
          }),
        }),
      }),
    )
    expect(result?.messages).toBeDefined()
    expectPersistedUnderWindow(input.system, result?.messages ?? [])
  })

  it('rethrows when checkpoint generation is aborted', async () => {
    const controller = new AbortController()
    generateCheckpoint.mockImplementation(async () => {
      controller.abort()
      throw new Error('aborted')
    })
    const { onEvent, input } = baseInput({ signal: controller.signal })
    const prepareStep = prepareParentCompactStep(input)

    await expect(
      prepareStep({
        messages: [{ role: 'assistant', content: hugeContent }],
      }),
    ).rejects.toThrow('aborted')
    expect(persistCompactionCheckpoint).not.toHaveBeenCalled()
    expect(onEvent).toHaveBeenCalledWith({ type: 'compaction-ended' })
  })

  it('throws a specific error when even a bounded rewrite cannot fit', async () => {
    const tinySettings = {
      version: 1,
      'models.default': 'local::qwen',
      'providers.custom.local': {
        type: 'openai-compatible',
        name: 'Local',
        baseURL: 'http://127.0.0.1:11434/v1',
        models: [{ id: 'qwen', contextWindow: 80, maxOutputTokens: 40 }],
      },
    } as VixlSettings
    const { onEvent, input } = baseInput({ settings: tinySettings })
    const prepareStep = prepareParentCompactStep(input)

    await expect(
      prepareStep({
        messages: [{ role: 'user', content: hugeContent }],
      }),
    ).rejects.toThrow(
      'Parent context still exceeds the model window after compaction',
    )
    expect(persistCompactionCheckpoint).not.toHaveBeenCalled()
    expect(onEvent).toHaveBeenCalledWith({ type: 'compaction-started' })
    expect(onEvent).toHaveBeenCalledWith({ type: 'compaction-ended' })
  })
})
