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

import consumeStream from '@/services/harness/orchestrator/consume-stream'

describe('consumeStream parent prepareStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const prepareStep = vi.fn<(options: { messages: unknown[] }) => Promise<unknown>>()
    prepareParentCompactStep.mockReturnValue(prepareStep)
    streamText.mockImplementation((config) => {
      return {
        fullStream: (async function* () {
          yield { type: 'start-step' }
          if (typeof config.prepareStep === 'function') {
            await config.prepareStep({
              messages: [{ role: 'assistant', content: 'x'.repeat(800_000) }],
            })
          }
          yield { type: 'finish-step', usage: { inputTokens: 1, outputTokens: 1 } }
        })(),
        text: Promise.resolve(''),
        responseMessages: Promise.resolve([]),
      }
    })
  })

  it('runs parent compact over high-water between steps', async () => {
    const prepareStep = vi.fn<(options: { messages: unknown[] }) => Promise<unknown>>()
      .mockResolvedValue({ messages: [{ role: 'user', content: 'rewritten' }] })
    prepareParentCompactStep.mockReturnValue(prepareStep)

    const prepared = {
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
    } as unknown as PreparedHarnessStream

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
