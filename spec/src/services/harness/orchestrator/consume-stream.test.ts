import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreparedHarnessStream } from '@/services/harness/orchestrator/prepare-stream'

const streamText = vi.hoisted(() =>
  vi.fn<(config: { prepareStep?: unknown }) => unknown>(),
)
const prepareParentCompactStep = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => (options: { messages: unknown[] }) => Promise<unknown>>(),
)

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => streamText(...(args as [ { prepareStep?: unknown } ])),
  isLoopFinished: () => () => true,
  smoothStream: () => ({}),
}))

vi.mock('@/services/billing/capture-billable-usage', () => ({
  default: vi.fn<(...args: unknown[]) => Promise<void>>(),
}))

vi.mock('@/services/harness/permission/approval-gate', () => ({
  rejectPendingForChat: vi.fn<() => void>(),
}))

vi.mock('@/services/harness/permission/question-gate', () => ({
  rejectPendingQuestionsForChat: vi.fn<() => void>(),
}))

vi.mock('@/services/mcp/mcp-auth-gate', () => ({
  rejectPendingMcpAuthForChat: vi.fn<() => void>(),
}))

vi.mock('@/services/harness/enrich-tool-error', () => ({
  default: (message: string) => message,
}))

vi.mock('@/services/harness/shell/registry', () => ({
  killShellsForChat: vi.fn<(...args: unknown[]) => Promise<void>>(),
}))

vi.mock('@/services/harness/subagent/registry', () => ({
  abort: vi.fn<() => void>(),
  hasPendingBackgroundResume: () => false,
  setTurnResponseMessages: vi.fn<() => void>(),
}))

vi.mock('@/services/harness/plan-execution-session', () => ({
  getPlanExecutionSession: () => ({ createdPlanThisTurn: false }),
}))

vi.mock('@/services/models/to-cached-instructions', () => ({
  default: (system: string) => system,
}))

vi.mock('@/services/harness/orchestrator/persistence', () => ({
  persistLine: vi.fn<(...args: unknown[]) => Promise<void>>(),
}))

vi.mock('@/services/harness/orchestrator/prepare-compact-step', () => ({
  default: (...args: unknown[]) => prepareParentCompactStep(...args),
}))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn<() => void>(), success: vi.fn<() => void>() },
}))

import captureBillableUsage from '@/services/billing/capture-billable-usage'
import consumeStream from '@/services/harness/orchestrator/consume-stream'

const mockStream = (options: {
  finishUsage?: unknown
  omitFinishUsage?: boolean
  finishSteps?: Array<{ usage?: unknown; omitUsage?: boolean }>
  totalUsage?: unknown
}): void => {
  streamText.mockImplementation((config) => {
    return {
      fullStream: (async function* () {
        const finishSteps = options.finishSteps ?? [
          {
            usage: options.finishUsage,
            omitUsage: options.omitFinishUsage,
          },
        ]
        for (const step of finishSteps) {
          yield { type: 'start-step' }
          if (typeof config.prepareStep === 'function') {
            await config.prepareStep({
              messages: [{ role: 'assistant', content: 'x'.repeat(800_000) }],
            })
          }
          if (step.omitUsage) {
            yield { type: 'finish-step' }
          } else {
            yield { type: 'finish-step', usage: step.usage }
          }
        }
      })(),
      text: Promise.resolve(''),
      responseMessages: Promise.resolve([]),
      usage: Promise.resolve(options.totalUsage),
    }
  })
}

const makePrepared = (): PreparedHarnessStream & {
  onEvent: ReturnType<typeof vi.fn>
} =>
  ({
    model: {},
    system: 'sys',
    finalModelMessages: [],
    tools: {},
    callModel: {
      optionRef: { providerId: 'local', modelId: 'qwen' },
      createRef: { providerId: 'local', modelId: 'qwen' },
    },
    callOptions: {},
    steps: {
      beginStep: vi.fn<() => Promise<void>>(),
      finishStep: vi.fn<() => Promise<void>>(),
      ensureStepOpen: vi.fn<() => Promise<void>>(),
      emitToolStart: vi.fn<() => Promise<void>>(),
      emitToolResult: vi.fn<() => Promise<void>>(),
      stepOpen: false,
      stepCount: 0,
      trailingText: '',
      assistantReasoning: '',
      collectedStepText: '',
      currentStepId: '',
      currentStepText: '',
    },
    projectSlug: 'demo',
    chatId: 'chat-1',
    modelId: 'qwen',
    settings: { version: 1 },
    assistantId: 'turn-1',
    signal: new AbortController().signal,
    onEvent: vi.fn<(...args: unknown[]) => void>(),
    captureTurnMessages: false,
    messages: [],
  }) as unknown as PreparedHarnessStream & { onEvent: ReturnType<typeof vi.fn> }

const contextUsageEvents = (onEvent: ReturnType<typeof vi.fn>): unknown[] =>
  onEvent.mock.calls
    .map((call) => call[0])
    .filter((event) => Boolean(event) && (event as { type?: string }).type === 'context-usage')

describe('consumeStream parent prepareStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const prepareStep = vi.fn<(options: { messages: unknown[] }) => Promise<unknown>>()
    prepareParentCompactStep.mockReturnValue(prepareStep)
    mockStream({ finishUsage: { inputTokens: 1, outputTokens: 1 } })
  })

  it('runs parent compact over high-water between steps', async () => {
    const prepareStep = vi.fn<(options: { messages: unknown[] }) => Promise<unknown>>()
      .mockResolvedValue({ messages: [{ role: 'user', content: 'rewritten' }] })
    prepareParentCompactStep.mockReturnValue(prepareStep)

    const prepared = makePrepared()
    await consumeStream(prepared)

    expect(prepareParentCompactStep).toHaveBeenCalledTimes(1)
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        prepareStep: prepareStep,
      }),
    )
    expect(prepareStep).toHaveBeenCalledWith({
      messages: [{ role: 'assistant', content: 'x'.repeat(800_000) }],
    })
  })
})

describe('consumeStream context-usage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const prepareStep = vi.fn<(options: { messages: unknown[] }) => Promise<unknown>>()
    prepareParentCompactStep.mockReturnValue(prepareStep)
  })

  it('reads finish-step tokens from raw prompt_tokens and completion_tokens', async () => {
    const rawUsage = {
      raw: { prompt_tokens: 100, completion_tokens: 50 },
    }
    mockStream({ finishUsage: rawUsage, totalUsage: { inputTokens: 1, outputTokens: 1 } })
    const prepared = makePrepared()

    await consumeStream(prepared)

    expect(contextUsageEvents(prepared.onEvent)).toEqual([
      {
        type: 'context-usage',
        modelId: 'qwen',
        promptTokens: 100,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    ])
    expect(captureBillableUsage).toHaveBeenCalledTimes(1)
    expect(captureBillableUsage).toHaveBeenCalledWith(
      expect.objectContaining({ usage: rawUsage }),
    )
  })

  it('falls back to result.usage when finish-step usage is missing', async () => {
    const totalUsage = { inputTokens: 40, outputTokens: 20 }
    mockStream({ omitFinishUsage: true, totalUsage })
    const prepared = makePrepared()

    await consumeStream(prepared)

    expect(contextUsageEvents(prepared.onEvent)).toEqual([
      {
        type: 'context-usage',
        modelId: 'qwen',
        promptTokens: 40,
        inputTokens: 40,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    ])
    expect(captureBillableUsage).toHaveBeenCalledWith(
      expect.objectContaining({ usage: totalUsage }),
    )
  })

  it('falls back to result.usage when a later finish-step has no tokens', async () => {
    const earlierUsage = { inputTokens: 10, outputTokens: 5 }
    const totalUsage = { inputTokens: 40, outputTokens: 20 }
    mockStream({
      finishSteps: [{ usage: earlierUsage }, { omitUsage: true }],
      totalUsage,
    })
    const prepared = makePrepared()

    await consumeStream(prepared)

    expect(captureBillableUsage).toHaveBeenCalledTimes(3)
    expect(captureBillableUsage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ usage: earlierUsage }),
    )
    expect(captureBillableUsage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ usage: undefined }),
    )
    expect(captureBillableUsage).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ usage: totalUsage }),
    )
    expect(contextUsageEvents(prepared.onEvent)).toEqual([
      {
        type: 'context-usage',
        modelId: 'qwen',
        promptTokens: 10,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      {
        type: 'context-usage',
        modelId: 'qwen',
        promptTokens: 40,
        inputTokens: 40,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    ])
  })

  it('does not capture result.usage when finish-step already had tokens', async () => {
    const stepUsage = { inputTokens: 10, outputTokens: 5 }
    mockStream({
      finishUsage: stepUsage,
      totalUsage: { inputTokens: 999, outputTokens: 888 },
    })
    const prepared = makePrepared()

    await consumeStream(prepared)

    expect(captureBillableUsage).toHaveBeenCalledTimes(1)
    expect(captureBillableUsage).toHaveBeenCalledWith(
      expect.objectContaining({ usage: stepUsage }),
    )
    expect(contextUsageEvents(prepared.onEvent)).toEqual([
      {
        type: 'context-usage',
        modelId: 'qwen',
        promptTokens: 10,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    ])
  })
})

describe('consumeStream tool-input-delta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const prepareStep = vi.fn<(options: { messages: unknown[] }) => Promise<unknown>>()
    prepareParentCompactStep.mockReturnValue(prepareStep)
  })

  it('forwards a path from tool-input-delta JSON', async () => {
    streamText.mockImplementation(() => ({
      fullStream: (async function* () {
        yield { type: 'tool-input-start', id: 'call-1', toolName: 'write_file' }
        yield { type: 'tool-input-delta', id: 'call-1', delta: '{"path":"src/a.ts","content":"' }
        yield { type: 'tool-input-delta', id: 'call-1', delta: 'hello"}' }
        yield {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'write_file',
          input: { path: 'src/a.ts', content: 'hello' },
        }
      })(),
      text: Promise.resolve(''),
      responseMessages: Promise.resolve([]),
      usage: Promise.resolve(undefined),
    }))

    const prepared = makePrepared()
    await consumeStream(prepared)

    expect(prepared.onEvent).toHaveBeenCalledWith({
      type: 'tool-input-start',
      toolCallId: 'call-1',
      name: 'write_file',
    })
    expect(prepared.onEvent).toHaveBeenCalledWith({
      type: 'tool-input-delta',
      toolCallId: 'call-1',
      name: 'write_file',
      args: { path: 'src/a.ts' },
    })
    expect(prepared.steps.emitToolStart).toHaveBeenCalledWith(
      'call-1',
      'write_file',
      { path: 'src/a.ts', content: 'hello' },
    )
  })

  it('does not emit tool-input-delta before the path string is complete', async () => {
    streamText.mockImplementation(() => ({
      fullStream: (async function* () {
        yield { type: 'tool-input-start', id: 'call-1', toolName: 'edit_file' }
        yield { type: 'tool-input-delta', id: 'call-1', delta: '{"path":"src/a.' }
      })(),
      text: Promise.resolve(''),
      responseMessages: Promise.resolve([]),
      usage: Promise.resolve(undefined),
    }))

    const prepared = makePrepared()
    await consumeStream(prepared)

    const deltaEvents = prepared.onEvent.mock.calls
      .map((call) => call[0])
      .filter((event) => (event as { type?: string }).type === 'tool-input-delta')
    expect(deltaEvents).toEqual([])
  })
})
