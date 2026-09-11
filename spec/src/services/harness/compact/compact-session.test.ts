import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelMessage, UIMessage } from 'ai'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const generateCheckpoint = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{
    summary: string
    usage: undefined | { inputTokens: number; outputTokens: number }
    providerMetadata: undefined | Record<string, unknown>
    responseId: undefined | string
    modelRef: { providerId: string; modelId: string }
  }>>(),
)
const persistCompactionCheckpoint = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{
    summary: string
    includeFromCreatedAt: string
    checkpointLineId: string
  }>>(),
)
const captureBillableUsage = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(),
)
const toastError = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
const createModel = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)
const resolveModelVision = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<boolean>>(),
)
const readChatMeta = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)

vi.mock('@/services/harness/compact/generate-checkpoint', () => ({
  default: (...args: unknown[]) => generateCheckpoint(...args),
}))

vi.mock('@/services/harness/compact/persist-checkpoint', () => ({
  default: (...args: unknown[]) => persistCompactionCheckpoint(...args),
}))

vi.mock('@/services/providers/create-model', () => ({
  default: (...args: unknown[]) => createModel(...args),
}))

vi.mock('@/services/billing/capture-billable-usage', () => ({
  default: (...args: unknown[]) => captureBillableUsage(...args),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}))

vi.mock('@/services/harness/resolve-model-vision', () => ({
  default: (...args: unknown[]) => resolveModelVision(...args),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    readChatMeta: (...args: unknown[]) => readChatMeta(...args),
  }),
)

import { compactBudgets, stillExceedsMessage } from '@/services/harness/compact'
import compactSession from '@/services/harness/compact-session'

const hugeContent = 'x'.repeat(800_000)

const settings = (): VixlSettings =>
  ({
    version: 1,
    'models.default': 'ollama::qwen',
  }) as VixlSettings

const tinyWindowSettings = (): VixlSettings =>
  ({
    version: 1,
    'models.default': 'local::qwen',
    'providers.custom.local': {
      type: 'openai-compatible',
      name: 'Local',
      baseURL: 'http://127.0.0.1:11434/v1',
      models: [{ id: 'qwen', contextWindow: 80, maxOutputTokens: 40 }],
    },
  }) as VixlSettings

const userMessage = (id: string, text: string, createdAt?: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
  ...(createdAt ? { metadata: { createdAt } } : {}),
})

const assistantMessage = (id: string, text: string): UIMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text }],
})

const compactInput = (
  overrides?: Partial<Parameters<typeof compactSession>[0]>,
): Parameters<typeof compactSession>[0] => ({
  projectSlug: 'proj',
  chatId: 'chat-1',
  projectRoot: '/tmp/proj',
  settings: settings(),
  messages: [],
  timeline: [],
  ...overrides,
})

describe('compactSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createModel.mockResolvedValue({ id: 'stub-model' })
    resolveModelVision.mockResolvedValue(false)
    readChatMeta.mockResolvedValue(null)
    generateCheckpoint.mockResolvedValue({
      summary: 'recap',
      usage: undefined,
      providerMetadata: undefined,
      responseId: undefined,
      modelRef: { providerId: 'ollama', modelId: 'qwen' },
    })
    persistCompactionCheckpoint.mockResolvedValue({
      summary: 'recap',
      includeFromCreatedAt: '2026-01-01T00:00:00.000Z',
      checkpointLineId: 'cp-1',
    })
    captureBillableUsage.mockResolvedValue(undefined)
    toastError.mockReset()
  })

  it('throws before generating a checkpoint when there is nothing to compact', async () => {
    await expect(compactSession(compactInput())).rejects.toThrow(
      'Nothing to compact',
    )

    expect(generateCheckpoint).not.toHaveBeenCalled()
    expect(persistCompactionCheckpoint).not.toHaveBeenCalled()
    expect(createModel).not.toHaveBeenCalled()
  })

  it('converts UI messages through the native model pipeline', async () => {
    const messages = [
      userMessage('u1', 'check the file'),
      {
        id: 'a1',
        role: 'assistant' as const,
        parts: [
          { type: 'text' as const, text: 'done' },
          {
            type: 'dynamic-tool' as const,
            toolName: 'read_file',
            toolCallId: 't1',
            state: 'output-available' as const,
            input: { path: '/tmp/a.txt' },
            output: { content: 'hello-tool-result' },
          },
        ],
      },
    ]

    await compactSession(compactInput({ messages }))

    expect(generateCheckpoint).toHaveBeenCalledTimes(1)
    const call = generateCheckpoint.mock.calls[0]?.[0] as {
      messages: ModelMessage[]
      system: string
      tools: Record<string, unknown>
      focus: string
      modelRef: { providerId: string; modelId: string }
    }
    expect(call.system).toBe('')
    expect(call.tools).toEqual({})
    expect(call.focus).toBe('none')
    expect(call.modelRef).toEqual({ providerId: 'ollama', modelId: 'qwen' })
    expect(createModel).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'ollama',
        modelId: 'qwen',
      }),
    )
    const serialized = JSON.stringify(call.messages)
    expect(serialized).toContain('check the file')
    expect(serialized).toContain('read_file')
    expect(serialized).toContain('hello-tool-result')
    expect(call.messages.every((message) => 'role' in message)).toBe(true)
    expect(call.messages.some((message) => 'parts' in message)).toBe(false)
  })

  it('prepends the active checkpoint like the orchestrator run path', async () => {
    readChatMeta.mockResolvedValue({
      activeContext: {
        checkpointLineId: 'cp-old',
        includeFromCreatedAt: '2026-06-01T00:00:00.000Z',
        summary: 'prior recap',
      },
    })
    const messages = [
      userMessage('old', 'stale turn', '2026-05-01T00:00:00.000Z'),
      userMessage('u2', 'new work', '2026-07-01T00:00:00.000Z'),
      assistantMessage('a2', 'working'),
    ]

    await compactSession(compactInput({ messages, focus: 'parent' }))

    const call = generateCheckpoint.mock.calls[0]?.[0] as {
      messages: ModelMessage[]
      focus: string
    }
    expect(call.focus).toBe('parent')
    expect(call.messages[0]).toEqual({
      role: 'user',
      content: `${compactBudgets.CHECKPOINT_PREFIX}\nprior recap`,
    })
    const serialized = JSON.stringify(call.messages)
    expect(serialized).toContain('new work')
    expect(serialized).not.toContain('stale turn')
  })

  it('returns usedFallback false and bills when a paid checkpoint succeeds', async () => {
    generateCheckpoint.mockResolvedValue({
      summary: 'recap',
      usage: { inputTokens: 2, outputTokens: 1 },
      providerMetadata: undefined,
      responseId: 'r1',
      modelRef: { providerId: 'ollama', modelId: 'qwen' },
    })
    const onEvent = vi.fn<(event: HarnessEvent) => void>()
    const messages = [
      userMessage('u1', 'check the file'),
      assistantMessage('a1', 'done'),
    ]

    const result = await compactSession(compactInput({ messages, onEvent }))

    expect(result.usedFallback).toBe(false)
    expect(persistCompactionCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'recap' }),
    )
    expect(captureBillableUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'compaction',
        providerId: 'ollama',
        modelId: 'qwen',
        responseId: 'r1',
        usage: { inputTokens: 2, outputTokens: 1 },
      }),
    )
  })

  it('keeps the persisted checkpoint when recording usage fails', async () => {
    captureBillableUsage.mockRejectedValue(new Error('billing network failed'))
    const onEvent = vi.fn<(event: HarnessEvent) => void>()
    const messages = [
      userMessage('u1', 'check the file'),
      assistantMessage('a1', 'done'),
    ]

    const result = await compactSession(compactInput({ messages, onEvent }))

    expect(result.usedFallback).toBe(false)
    expect(result.checkpointLineId).toBe('cp-1')
    expect(persistCompactionCheckpoint).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith(
      'Failed to record compaction usage',
      expect.objectContaining({ description: 'billing network failed' }),
    )
  })

  it('persists a deterministic fallback summary when checkpoint generation fails', async () => {
    generateCheckpoint.mockRejectedValue(new Error('prompt is too long'))
    const messages = [
      userMessage('u1', 'check the file'),
      assistantMessage('a1', 'working'),
    ]

    const result = await compactSession(
      compactInput({ messages, onEvent: vi.fn<(event: HarnessEvent) => void>() }),
    )

    expect(result.usedFallback).toBe(true)
    expect(generateCheckpoint).toHaveBeenCalledTimes(1)
    expect(captureBillableUsage).not.toHaveBeenCalled()
    expect(persistCompactionCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.stringContaining('Deterministic compaction fallback'),
      }),
    )
  })

  it('skips generation and persists fallback when the prompt is already over the hard window', async () => {
    const messages = [userMessage('u1', hugeContent)]

    const result = await compactSession(
      compactInput({ messages, onEvent: vi.fn<(event: HarnessEvent) => void>() }),
    )

    expect(generateCheckpoint).not.toHaveBeenCalled()
    expect(captureBillableUsage).not.toHaveBeenCalled()
    expect(result.usedFallback).toBe(true)
    expect(persistCompactionCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.stringContaining('Deterministic compaction fallback'),
      }),
    )
  })

  it('bills a paid checkpoint when the persisted summary is the overflow fallback', async () => {
    generateCheckpoint.mockResolvedValue({
      summary: 'M'.repeat(800_000),
      usage: { inputTokens: 40, outputTokens: 20 },
      providerMetadata: { paid: true },
      responseId: 'r-paid',
      modelRef: { providerId: 'ollama', modelId: 'qwen' },
    })
    const onEvent = vi.fn<(event: HarnessEvent) => void>()
    const messages = [
      userMessage('u1', 'Find the auth bug.'),
      assistantMessage('a1', 'Inspecting token refresh.'),
    ]

    const result = await compactSession(compactInput({ messages, onEvent }))

    expect(result.usedFallback).toBe(true)
    expect(persistCompactionCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.stringContaining('Deterministic compaction fallback'),
      }),
    )
    expect(captureBillableUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'compaction',
        providerId: 'ollama',
        modelId: 'qwen',
        responseId: 'r-paid',
        usage: { inputTokens: 40, outputTokens: 20 },
      }),
    )
  })

  it('rethrows abort and persists nothing', async () => {
    const controller = new AbortController()
    generateCheckpoint.mockImplementation(async () => {
      controller.abort()
      throw new Error('aborted')
    })
    const messages = [
      userMessage('u1', 'check the file'),
      assistantMessage('a1', 'working'),
    ]

    await expect(
      compactSession(compactInput({ messages, signal: controller.signal })),
    ).rejects.toThrow('aborted')
    expect(persistCompactionCheckpoint).not.toHaveBeenCalled()
    expect(captureBillableUsage).not.toHaveBeenCalled()
  })

  it('throws the shared still-exceeds message when bounding cannot fit under high water', async () => {
    const messages = [userMessage('u1', hugeContent)]

    await expect(
      compactSession(
        compactInput({ messages, settings: tinyWindowSettings() }),
      ),
    ).rejects.toThrow(stillExceedsMessage('none'))
    expect(persistCompactionCheckpoint).not.toHaveBeenCalled()
  })
})
