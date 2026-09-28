import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import type { ContinueOrchestratorInput } from '@/types/harness/orchestrator-input'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'
import buildContinueNudge from '@/services/harness/orchestrator/build-continue-nudge'

const persistLine = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)
const runHarnessStream = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)
const runSideTask = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<string | null>>().mockResolvedValue(null),
)

vi.mock('@/services/harness/orchestrator/persistence', () => ({
  persistLine: (...args: unknown[]) => persistLine(...args),
}))

vi.mock('@/services/harness/orchestrator/stream', () => ({
  default: (...args: unknown[]) => runHarnessStream(...args),
}))

vi.mock('@/services/harness/run-side-task', () => ({
  default: (...args: unknown[]) => runSideTask(...args),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    readChatMeta: vi.fn<() => Promise<null>>().mockResolvedValue(null),
  }),
)

vi.mock('@/services/providers/create-model', () => ({
  default: vi.fn<() => Promise<{ id: string }>>(async () => ({ id: 'stub-model' })),
}))

vi.mock('@/services/harness/resolve-model-vision', () => ({
  default: vi.fn<() => Promise<boolean>>(async () => false),
}))

import continueOrchestrator from '@/services/harness/orchestrator/continue'

const userMessage: UIMessage = {
  id: 'user-1',
  role: 'user',
  parts: [{ type: 'text', text: 'map the repo' }],
}

const partialAssistant: UIMessage = {
  id: 'asst-1',
  role: 'assistant',
  parts: [
    { type: 'text', text: 'checking the files' },
    { type: 'step-start' },
    {
      type: 'dynamic-tool',
      toolName: 'read_file',
      toolCallId: 'tc-1',
      state: 'output-available',
      input: { path: 'README.md' },
      output: { content: 'hello' },
    },
    {
      type: 'dynamic-tool',
      toolName: 'grep',
      toolCallId: 'tc-stopped',
      state: 'output-available',
      input: { pattern: 'TODO' },
      output: { stopped: true },
    },
    {
      type: 'dynamic-tool',
      toolName: 'read_file',
      toolCallId: 'tc-open',
      state: 'input-streaming',
    },
  ],
}

const buildInput = (
  overrides: Partial<ContinueOrchestratorInput> = {},
): ContinueOrchestratorInput =>
  ({
    workspace: {
      projectSlug: 'proj',
      projectRoot: '/tmp/proj',
      projectName: 'proj',
    },
    projectSlug: 'proj',
    chatId: 'chat-1',
    projectRoot: '/tmp/proj',
    projectName: 'proj',
    mode: 'agent',
    modelId: 'gpt-4o',
    providerId: 'openai',
    settings: { version: 1 } as VixlSettings,
    messages: [userMessage, partialAssistant],
    mentions: [{ type: 'file', path: 'src/foo.ts' }],
    signal: new AbortController().signal,
    onEvent: vi.fn<(...args: unknown[]) => void>(),
    assistantId: 'asst-1',
    userMessageId: 'user-1',
    sessionAllows: new Set<string>(),
    sessionDenies: new Set<string>(),
    ...overrides,
  }) as ContinueOrchestratorInput

type StreamModelMessage = {
  role: string
  content:
    | string
    | Array<{
        type: string
        text?: string
        toolCallId?: string
        toolName?: string
        input?: unknown
        output?: { type: string; value: unknown }
      }>
}

describe('continueOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    persistLine.mockResolvedValue(undefined)
    runHarnessStream.mockResolvedValue(undefined)
    runSideTask.mockResolvedValue(null)
  })

  it('sends prior user, partial assistant, tool results, and a continue nudge', async () => {
    await continueOrchestrator(buildInput())

    const streamInput = runHarnessStream.mock.calls[0]?.[0] as {
      modelMessages: StreamModelMessage[]
    }
    const modelMessages = streamInput.modelMessages

    expect(modelMessages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'map the repo' }],
    })
    expect(modelMessages).toContainEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'checking the files' }],
    })
    expect(modelMessages).toContainEqual({
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'tc-1',
          toolName: 'read_file',
          input: { path: 'README.md' },
          providerExecuted: undefined,
        },
        {
          type: 'tool-call',
          toolCallId: 'tc-stopped',
          toolName: 'grep',
          input: { pattern: 'TODO' },
          providerExecuted: undefined,
        },
      ],
    })
    expect(modelMessages).toContainEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName: 'read_file',
          output: { type: 'json', value: { content: 'hello' } },
        },
        {
          type: 'tool-result',
          toolCallId: 'tc-stopped',
          toolName: 'grep',
          output: {
            type: 'error-text',
            value: 'Interrupted by provider error',
          },
        },
      ],
    })
    expect(
      modelMessages.some((message) =>
        Array.isArray(message.content)
          ? message.content.some((part) => part.toolCallId === 'tc-open')
          : false,
      ),
    ).toBe(false)
    expect(modelMessages.at(-1)).toEqual({
      role: 'user',
      content: buildContinueNudge(),
    })
  })

  it('does not persist a user line or run title generation', async () => {
    await continueOrchestrator(buildInput())

    expect(persistLine).not.toHaveBeenCalled()
    expect(runSideTask).not.toHaveBeenCalled()
  })

  it('passes through assistantId, userMessageId, and empty mentions', async () => {
    await continueOrchestrator(buildInput({ standalone: true }))

    expect(runHarnessStream).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantId: 'asst-1',
        userMessageId: 'user-1',
        mentions: [],
        captureTurnMessages: true,
        standalone: true,
      }),
    )
  })
})
