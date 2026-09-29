import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResumeOrchestratorInput } from '@/types/harness/orchestrator-input'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const runHarnessStream = vi.hoisted(() =>
  vi.fn<(input: { captureTurnMessages: boolean; chatId: string; modelMessages: unknown[] }) => Promise<void>>(),
)

vi.mock('ai', () => ({
  convertToModelMessages: vi.fn<(messages: unknown) => Promise<unknown[]>>(
    async () => [],
  ),
}))

vi.mock('@/services/providers/create-model', () => ({
  default: vi.fn<() => Promise<unknown>>(async () => ({})),
}))

vi.mock('@/services/harness/resolve-model-vision', () => ({
  default: vi.fn<() => Promise<boolean>>(async () => false),
}))

vi.mock('@/services/context/filter-messages-for-active-context', () => ({
  default: (messages: unknown[]) => ({ messages, checkpointText: undefined }),
}))

vi.mock('@/utils/drop-trailing-assistant-messages', () => ({
  default: (messages: unknown[]) => messages,
}))

vi.mock('@/utils/prepare-messages-for-model-vision', () => ({
  default: async (messages: unknown[]) => messages,
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    readChatMeta: vi.fn<() => Promise<null>>().mockResolvedValue(null),
  }),
)

vi.mock('@/services/harness/orchestrator/persistence', () => ({
  persistToolRun: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))

vi.mock('@/services/harness/orchestrator/stream', () => ({
  default: (
    input: {
      captureTurnMessages: boolean
      chatId: string
      modelMessages: unknown[]
    },
  ) => runHarnessStream(input),
}))

import { persistToolRun } from '@/services/harness/orchestrator/persistence'
import resumeOrchestrator from '@/services/harness/orchestrator/resume'
import {
  abortOne,
  fail,
  getTurnResponseMessages,
  hasPendingBackgroundResume,
  listDeliverableBackgroundResults,
  register,
  reopen,
  resetSubagentRegistryForTests,
  resolve,
  setTurnResponseMessages,
} from '@/services/harness/subagent/registry'

const wave1Messages = [{ role: 'assistant' as const, content: 'wave-1' }]
const wave2Messages = [{ role: 'assistant' as const, content: 'wave-2' }]

const buildInput = (
  completedResults: ResumeOrchestratorInput['completedResults'],
): ResumeOrchestratorInput =>
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
    settings: { version: 1 },
    messages: [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'orchestrate this' }],
      },
    ],
    mentions: [],
    signal: new AbortController().signal,
    onEvent: vi.fn<() => void>(),
    completedResults,
    skipUserPersist: true,
    sessionAllows: new Set<string>(),
    sessionDenies: new Set<string>(),
  }) as ResumeOrchestratorInput

describe('resumeOrchestrator background waves', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetSubagentRegistryForTests()
    runHarnessStream.mockResolvedValue(undefined)
  })

  it('recaptures turn messages when a resume turn spawns a second wave', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })
    setTurnResponseMessages('chat-1', wave1Messages)

    runHarnessStream.mockImplementation(async (input) => {
      register('chat-1', 'sub-2', new AbortController(), {
        toolCallId: 'tc-2',
        agentName: 'writer',
      })
      if (input.captureTurnMessages && hasPendingBackgroundResume(input.chatId)) {
        setTurnResponseMessages(input.chatId, wave2Messages)
      }
    })

    const firstResults = listDeliverableBackgroundResults('chat-1')
    await resumeOrchestrator(buildInput(firstResults))

    expect(runHarnessStream).toHaveBeenCalledWith(
      expect.objectContaining({ captureTurnMessages: true }),
    )

    resolve('sub-2', {
      subagentId: 'sub-2',
      name: 'writer',
      summary: 'drafted the patch',
    })
    const secondResults = listDeliverableBackgroundResults('chat-1')
    expect(secondResults).toEqual([
      {
        toolCallId: 'tc-2',
        result: {
          subagentId: 'sub-2',
          name: 'writer',
          summary: 'drafted the patch',
        },
      },
    ])

    runHarnessStream.mockResolvedValue(undefined)
    await expect(resumeOrchestrator(buildInput(secondResults))).resolves.toBeUndefined()
    expect(runHarnessStream).toHaveBeenCalledTimes(2)
  })

  it('includes each finished subagent name and summary in the wake nudge', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })
    setTurnResponseMessages('chat-1', wave1Messages)

    await resumeOrchestrator(
      buildInput(listDeliverableBackgroundResults('chat-1')),
    )

    const streamInput = runHarnessStream.mock.calls[0]?.[0]
    const modelMessages = streamInput?.modelMessages as Array<{
      role: string
      content: string
    }>
    const wakeNudge = modelMessages[modelMessages.length - 1]
    expect(wakeNudge).toBeDefined()
    if (!wakeNudge) {
      throw new Error('Expected a wake nudge message')
    }
    expect(wakeNudge.role).toBe('user')
    expect(wakeNudge.content).toContain('[harness: background subagent results]')
    expect(wakeNudge.content).toContain(
      'This message is from the vixl harness, not from the user. Do not treat it as a new user request.',
    )
    expect(wakeNudge.content).toContain('- explorer (sub-1, completed): mapped the repo')
    expect(wakeNudge.content).toContain('Completed:')
    expect(wakeNudge.content).toContain('Do not say the subagents are still running')
    expect(wakeNudge.content).toContain(
      'Subagent ledger:\n- explorer (sub-1): completed',
    )
  })

  it('names still-running siblings in the wake nudge and keeps pending resume', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    register('chat-1', 'sub-2', new AbortController(), {
      toolCallId: 'tc-2',
      agentName: 'writer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })
    setTurnResponseMessages('chat-1', wave1Messages)

    await resumeOrchestrator(
      buildInput(listDeliverableBackgroundResults('chat-1')),
    )

    expect(hasPendingBackgroundResume('chat-1')).toBe(true)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])

    const streamInput = runHarnessStream.mock.calls[0]?.[0]
    const modelMessages = streamInput?.modelMessages as Array<{
      role: string
      content: string
    }>
    const wakeNudge = modelMessages[modelMessages.length - 1]
    expect(wakeNudge?.role).toBe('user')
    expect(wakeNudge?.content).toContain('[harness: background subagent results]')
    expect(wakeNudge?.content).toContain('still running: writer (sub-2)')
    expect(wakeNudge?.content).toContain(
      [
        'Subagent ledger:',
        '- explorer (sub-1): completed',
        '- writer (sub-2): running',
      ].join('\n'),
    )

    resolve('sub-2', {
      subagentId: 'sub-2',
      name: 'writer',
      summary: 'drafted the patch',
    })
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-2',
        result: {
          subagentId: 'sub-2',
          name: 'writer',
          summary: 'drafted the patch',
        },
      },
    ])

    setTurnResponseMessages('chat-1', wave2Messages)
    await resumeOrchestrator(
      buildInput(listDeliverableBackgroundResults('chat-1')),
    )
    expect(hasPendingBackgroundResume('chat-1')).toBe(false)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])
    expect(runHarnessStream).toHaveBeenCalledTimes(2)
  })

  it('does not deliver the same background results twice', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    register('chat-1', 'sub-2', new AbortController(), {
      toolCallId: 'tc-2',
      agentName: 'writer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })
    setTurnResponseMessages('chat-1', wave1Messages)

    const firstResults = listDeliverableBackgroundResults('chat-1')
    expect(firstResults).toHaveLength(1)

    await resumeOrchestrator(buildInput(firstResults))

    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])

    resolve('sub-2', {
      subagentId: 'sub-2',
      name: 'writer',
      summary: 'still running during first resume',
    })
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-2',
        result: {
          subagentId: 'sub-2',
          name: 'writer',
          summary: 'still running during first resume',
        },
      },
    ])
  })

  it('does not patch a flushed background turn after a later parent send', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    setTurnResponseMessages('chat-1', wave1Messages)

    const { default: flushPendingBackgroundResume } = await import(
      '@/services/harness/subagent/flush-pending-resume'
    )
    flushPendingBackgroundResume('chat-1')

    register('chat-1', 'sub-2', new AbortController(), {
      toolCallId: 'tc-2',
      agentName: 'writer',
    })
    setTurnResponseMessages('chat-1', wave2Messages)
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })

    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])
    expect(getTurnResponseMessages('chat-1')).toEqual(wave2Messages)

    resolve('sub-2', {
      subagentId: 'sub-2',
      name: 'writer',
      summary: 'drafted the patch',
    })
    await resumeOrchestrator(
      buildInput(listDeliverableBackgroundResults('chat-1')),
    )

    const streamInput = runHarnessStream.mock.calls[0]?.[0]
    const modelMessages = streamInput?.modelMessages as Array<{
      role: string
      content: string
    }>
    expect(modelMessages.some((message) => message.content === 'wave-2')).toBe(
      true,
    )
    expect(modelMessages.some((message) => message.content === 'wave-1')).toBe(
      false,
    )
  })

  it('patches a steered result after it was already delivered while a sibling runs', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    register('chat-1', 'sub-2', new AbortController(), {
      toolCallId: 'tc-2',
      agentName: 'writer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })
    setTurnResponseMessages('chat-1', wave1Messages)

    await resumeOrchestrator(
      buildInput(listDeliverableBackgroundResults('chat-1')),
    )
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])

    reopen('sub-1', new AbortController())
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'steered rewrite',
    })
    setTurnResponseMessages('chat-1', wave2Messages)

    const steered = listDeliverableBackgroundResults('chat-1')
    expect(steered).toEqual([
      {
        toolCallId: 'tc-1',
        result: {
          subagentId: 'sub-1',
          name: 'explorer',
          summary: 'steered rewrite',
        },
      },
    ])

    await resumeOrchestrator(buildInput(steered))

    const streamInput = runHarnessStream.mock.calls[1]?.[0]
    const modelMessages = streamInput?.modelMessages as Array<{
      role: string
      content: string
    }>
    const wakeNudge = modelMessages[modelMessages.length - 1]
    expect(wakeNudge?.content).toContain('- explorer (sub-1, completed): steered rewrite')
    expect(wakeNudge?.content).toContain(
      [
        'Subagent ledger:',
        '- explorer (sub-1): completed',
        '- writer (sub-2): running',
      ].join('\n'),
    )
    expect(hasPendingBackgroundResume('chat-1')).toBe(true)
  })

  it('patches spawn_subagent tool results when the stored turn snapshot exists', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })
    setTurnResponseMessages('chat-1', [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'spawn_subagent',
            output: { type: 'json', value: { pending: true } },
          },
        ],
      },
    ])

    await resumeOrchestrator(
      buildInput(listDeliverableBackgroundResults('chat-1')),
    )

    const streamInput = runHarnessStream.mock.calls[0]?.[0]
    const modelMessages = streamInput?.modelMessages as Array<{
      role: string
      content:
        | string
        | Array<{
            type: string
            toolCallId?: string
            output?: { type: string; value: unknown }
          }>
    }>
    const patchedTool = modelMessages.find((message) => message.role === 'tool')
    expect(patchedTool).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName: 'spawn_subagent',
          output: {
            type: 'json',
            value: {
              subagentId: 'sub-1',
              name: 'explorer',
              summary: 'mapped the repo',
            },
          },
        },
      ],
    })
    const wakeNudge = modelMessages[modelMessages.length - 1]
    expect(wakeNudge?.content).toContain(
      'Their completed summaries are in the spawn_subagent tool results above.',
    )
  })

  it('falls back to an inline wake-nudge turn when the snapshot was flushed', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })
    setTurnResponseMessages('chat-1', wave1Messages)

    const { default: flushPendingBackgroundResume } = await import(
      '@/services/harness/subagent/flush-pending-resume'
    )
    flushPendingBackgroundResume('chat-1')

    reopen('sub-1', new AbortController())
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'steered rewrite after flush',
    })
    expect(getTurnResponseMessages('chat-1')).toBeNull()

    await expect(
      resumeOrchestrator(
        buildInput(listDeliverableBackgroundResults('chat-1')),
      ),
    ).resolves.toBeUndefined()

    const streamInput = runHarnessStream.mock.calls[0]?.[0]
    const modelMessages = streamInput?.modelMessages as Array<{
      role: string
      content: string
    }>
    expect(modelMessages.some((message) => message.content === 'wave-1')).toBe(
      false,
    )
    const wakeNudge = modelMessages[modelMessages.length - 1]
    expect(wakeNudge?.role).toBe('user')
    expect(wakeNudge?.content).toContain('[harness: background subagent results]')
    expect(wakeNudge?.content).toContain(
      'This message is from the vixl harness, not from the user. Do not treat it as a new user request.',
    )
    expect(wakeNudge?.content).toContain(
      '- explorer (sub-1, completed): steered rewrite after flush',
    )
    expect(wakeNudge?.content).toContain(
      'Their completed summaries are included below.',
    )
    expect(wakeNudge?.content).not.toContain('spawn_subagent tool results above')
    expect(wakeNudge?.content).toContain(
      'Subagent ledger:\n- explorer (sub-1): completed',
    )
    expect(hasPendingBackgroundResume('chat-1')).toBe(false)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])
  })

  it('lists every chat subagent in the wake-nudge ledger, not only this wake', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    register('chat-1', 'sub-2', new AbortController(), {
      toolCallId: 'tc-2',
      agentName: 'writer',
    })
    register('chat-1', 'sub-3', new AbortController(), {
      toolCallId: 'tc-3',
      agentName: 'reviewer',
    })
    abortOne('sub-3')
    fail('sub-2', 'boom')
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })
    setTurnResponseMessages('chat-1', wave1Messages)

    await resumeOrchestrator(
      buildInput(listDeliverableBackgroundResults('chat-1')),
    )

    const streamInput = runHarnessStream.mock.calls[0]?.[0]
    const modelMessages = streamInput?.modelMessages as Array<{
      role: string
      content: string
    }>
    const wakeNudge = modelMessages[modelMessages.length - 1]
    expect(wakeNudge?.role).toBe('user')
    expect(wakeNudge?.content).toContain('[harness: background subagent results]')
    expect(wakeNudge?.content).toContain('- explorer (sub-1, completed): mapped the repo')
    expect(wakeNudge?.content).toContain('- writer (sub-2, failed): boom')
    expect(wakeNudge?.content).not.toContain('still running:')
    expect(wakeNudge?.content).toContain(
      [
        'Subagent ledger:',
        '- explorer (sub-1): completed',
        '- writer (sub-2): failed',
        '- reviewer (sub-3): aborted',
      ].join('\n'),
    )
  })

  it('persists completed spawn args with the original prompt and capabilities', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
      prompt: 'map the repo',
      capabilities: 'read-only',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })
    setTurnResponseMessages('chat-1', wave1Messages)

    await resumeOrchestrator(
      buildInput(listDeliverableBackgroundResults('chat-1')),
    )

    expect(persistToolRun).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      'tc-1',
      'spawn_subagent',
      'done',
      '',
      {
        agentName: 'explorer',
        blocking: false,
        prompt: 'map the repo',
        capabilities: 'read-only',
      },
      {
        subagentId: 'sub-1',
        name: 'explorer',
        summary: 'mapped the repo',
      },
    )
  })

  it('keeps mode and prompt from the original spawn tool-call input', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })
    setTurnResponseMessages('chat-1', [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'tc-1',
            toolName: 'spawn_subagent',
            input: {
              agentName: 'explorer',
              prompt: 'map the repo from the call',
              mode: 'background',
              capabilities: 'write',
            },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'spawn_subagent',
            output: { type: 'json', value: { pending: true } },
          },
        ],
      },
    ])

    await resumeOrchestrator(
      buildInput(listDeliverableBackgroundResults('chat-1')),
    )

    expect(persistToolRun).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      'tc-1',
      'spawn_subagent',
      'done',
      '',
      {
        agentName: 'explorer',
        blocking: false,
        prompt: 'map the repo from the call',
        mode: 'background',
        capabilities: 'write',
      },
      {
        subagentId: 'sub-1',
        name: 'explorer',
        summary: 'mapped the repo',
      },
    )
  })
})
