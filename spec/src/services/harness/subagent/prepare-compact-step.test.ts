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
const captureBillableUsage = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(),
)

vi.mock('@/services/harness/compact/generate-checkpoint', () => ({
  default: (...args: unknown[]) => generateCheckpoint(...args),
}))

vi.mock('@/services/billing/capture-billable-usage', () => ({
  default: (...args: unknown[]) => captureBillableUsage(...args),
}))

import prepareCompactStep from '@/services/harness/subagent/prepare-compact-step'

const childModelRef: ModelRef = {
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
  summary: 'Subagent found the auth bug.',
  usage: { inputTokens: 12, outputTokens: 5 },
  providerMetadata: { test: true },
  responseId: 'resp-compact-1',
  modelRef: { providerId: 'openai', modelId: 'gpt-4o' },
}

const baseInput = (overrides?: { settings?: VixlSettings; signal?: AbortSignal }) => {
  const emitNestedEvent = vi.fn<(event: HarnessEvent) => void>()
  const onBillEvent = vi.fn<(event: HarnessEvent) => void>()
  return {
    emitNestedEvent,
    onBillEvent,
    input: {
      settings: overrides?.settings ?? settings,
      model: stubModel,
      modelRef: childModelRef,
      system: 'You are a child subagent.',
      providerOptions: stubProviderOptions,
      tools: stubTools,
      signal: overrides?.signal ?? new AbortController().signal,
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
    generateCheckpoint.mockReset()
    captureBillableUsage.mockReset()
    generateCheckpoint.mockResolvedValue(compactedResult)
    captureBillableUsage.mockResolvedValue(undefined)
  })

  it('returns undefined under budget and does not summarize', async () => {
    const { emitNestedEvent, input } = baseInput()
    const prepareStep = prepareCompactStep(input)

    const result = await prepareStep({
      messages: [{ role: 'user', content: 'short task' }],
    })

    expect(result).toBeUndefined()
    expect(generateCheckpoint).not.toHaveBeenCalled()
    expect(captureBillableUsage).not.toHaveBeenCalled()
    expect(emitNestedEvent).not.toHaveBeenCalled()
  })

  it('checkpoints once when over budget, rewrites, emits, and bills compaction', async () => {
    const { emitNestedEvent, onBillEvent, input } = baseInput()
    const prepareStep = prepareCompactStep(input)
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Spawn: find the auth bug.' },
      { role: 'assistant', content: hugeContent },
    ]

    const result = await prepareStep({ messages })

    expect(generateCheckpoint).toHaveBeenCalledTimes(1)
    expect(generateCheckpoint).toHaveBeenCalledWith({
      model: stubModel,
      modelRef: childModelRef,
      system: 'You are a child subagent.',
      providerOptions: stubProviderOptions,
      tools: stubTools,
      messages,
      focus: 'subagent',
      signal: input.signal,
    })
    expect(emitNestedEvent).toHaveBeenCalledWith({
      type: 'compaction-started',
    })
    expect(emitNestedEvent).toHaveBeenCalledWith({
      type: 'compaction',
      summary: compactedResult.summary,
      focus: 'subagent',
    })
    expect(emitNestedEvent).toHaveBeenCalledWith({
      type: 'compaction-ended',
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
    expect(result?.messages).toBeDefined()
    expect(estimatePromptTokens(input.system, result?.messages ?? [])).toBeLessThanOrEqual(
      resolveCompactHighWater(settings, childModelRef),
    )
    const checkpoint = result?.messages?.[1]
    expect(
      checkpoint && 'content' in checkpoint ? checkpoint.content : '',
    ).toContain(compactBudgets.CHECKPOINT_PREFIX)
  })

  it('still rewrites when billing fails after a successful compaction', async () => {
    captureBillableUsage.mockRejectedValue(new Error('billing network failed'))
    const { emitNestedEvent, input } = baseInput()
    const prepareStep = prepareCompactStep(input)
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Spawn: find the auth bug.' },
      { role: 'assistant', content: hugeContent },
    ]

    const result = await prepareStep({ messages })

    expect(result?.messages).toBeDefined()
    expect(emitNestedEvent).toHaveBeenCalledWith({ type: 'compaction-ended' })
  })

  it('bounds an oversized first user message', async () => {
    const { input } = baseInput()
    const prepareStep = prepareCompactStep(input)

    const result = await prepareStep({
      messages: [{ role: 'user', content: hugeContent }],
    })

    expect(captureBillableUsage).toHaveBeenCalledTimes(1)
    expect(result?.messages).toBeDefined()
    expect(estimatePromptTokens(input.system, result?.messages ?? [])).toBeLessThanOrEqual(
      resolveCompactHighWater(settings, childModelRef),
    )
  })

  it('bounds a huge tool output', async () => {
    const { input } = baseInput()
    const prepareStep = prepareCompactStep(input)
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Spawn: find the auth bug.' },
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

    expect(result?.messages).toBeDefined()
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
    const prepareStep = prepareCompactStep(input)

    const result = await prepareStep({
      messages: [
        { role: 'user', content: 'Spawn: find the auth bug.' },
        { role: 'assistant', content: hugeContent },
      ],
    })

    expect(captureBillableUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'compaction',
        responseId: compactedResult.responseId,
        subagentId: 'sub-1',
      }),
    )
    expect(result?.messages).toBeDefined()
  })

  it('uses a fallback checkpoint when generation fails', async () => {
    generateCheckpoint.mockRejectedValue(new Error('prompt is too long'))
    const { emitNestedEvent, input } = baseInput()
    const prepareStep = prepareCompactStep(input)

    const result = await prepareStep({
      messages: [
        { role: 'user', content: 'Spawn: find the auth bug.' },
        { role: 'assistant', content: hugeContent },
      ],
    })

    expect(captureBillableUsage).not.toHaveBeenCalled()
    expect(emitNestedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'compaction',
        summary: expect.stringContaining('Deterministic compaction fallback'),
        focus: 'subagent',
      }),
    )
    expect(result?.messages).toBeDefined()
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
    const { emitNestedEvent, input } = baseInput({ settings: tinySettings })
    const prepareStep = prepareCompactStep(input)

    await expect(
      prepareStep({
        messages: [{ role: 'assistant', content: hugeContent }],
      }),
    ).rejects.toThrow(
      'Subagent context still exceeds the model window after compaction',
    )
    expect(captureBillableUsage).not.toHaveBeenCalled()
    expect(emitNestedEvent).toHaveBeenCalledWith({ type: 'compaction-started' })
    expect(emitNestedEvent).toHaveBeenCalledWith({ type: 'compaction-ended' })
  })
})
