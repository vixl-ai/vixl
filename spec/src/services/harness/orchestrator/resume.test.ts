import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResumeOrchestratorInput } from '@/types/harness/orchestrator-input'
import { mockTauriEvent } from '../../../test-utils/mocks/tauri-event'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const listen = vi.hoisted(() =>
  vi.fn<(event: string, handler: unknown) => Promise<() => void>>(
    async () => () => {},
  ),
)

vi.mock('@tauri-apps/api/event', () => mockTauriEvent({ listen }))

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
  persistLine: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
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

import { persistLine, persistToolRun } from '@/services/harness/orchestrator/persistence'
import { finalizeBackgroundSpawnResults } from '@/services/harness/orchestrator/finalize-background-spawns'
import persistResumeOverlay from '@/services/harness/orchestrator/persist-resume-overlay'
import resumeOrchestrator from '@/services/harness/orchestrator/resume'
import resetResumeOverlay from '@/services/harness/orchestrator/reset-resume-overlay'
import buildShellWakeNudge from '@/services/harness/orchestrator/build-shell-wake-nudge'
import { shellResultKey } from '@/services/harness/orchestrator/shell-wake'
import {
  createAgentShell,
  hasPendingShellResume,
  listDeliverableShellResults,
  resetAgentShellRegistryForTests,
} from '@/services/harness/shell/registry'
import { isBackgroundResultDelivered } from '@/services/harness/subagent/background-result-sets'
import {
  abortOne,
  fail,
  getTurnResponseMessages,
  hasPendingBackgroundResume,
  isBackgroundResultFinalized,
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
  extras: Partial<ResumeOrchestratorInput> = {},
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
    ...extras,
  }) as ResumeOrchestratorInput

describe('resumeOrchestrator background waves', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetSubagentRegistryForTests()
    resetAgentShellRegistryForTests()
    resetResumeOverlay()
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
      'Sent by the vixl harness, not a new user request.',
    )
    expect(wakeNudge.content).toContain('- explorer (sub-1, completed): mapped the repo')
    expect(wakeNudge.content).toContain('Completed:')
    expect(wakeNudge.content).toContain('All background subagents have finished')
    expect(wakeNudge.content).toContain(
      'Subagent ledger:\n- explorer (sub-1): completed: mapped the repo',
    )
  })

  it('keeps pending resume when a sibling finishes during resume awaits', async () => {
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
    vi.mocked(persistToolRun).mockImplementationOnce(async () => {
      resolve('sub-2', {
        subagentId: 'sub-2',
        name: 'writer',
        summary: 'drafted the patch',
      })
    })

    await resumeOrchestrator(
      buildInput(listDeliverableBackgroundResults('chat-1')),
    )

    expect(hasPendingBackgroundResume('chat-1')).toBe(true)
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
    expect(runHarnessStream).toHaveBeenCalledTimes(1)
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
        '- explorer (sub-1): completed: mapped the repo',
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

    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-1',
        result: {
          subagentId: 'sub-1',
          name: 'explorer',
          summary: 'mapped the repo',
        },
      },
    ])
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
        '- explorer (sub-1): completed: steered rewrite',
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
      'Summaries are in the spawn_subagent tool results above.',
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
      'Sent by the vixl harness, not a new user request.',
    )
    expect(wakeNudge?.content).toContain(
      '- explorer (sub-1, completed): steered rewrite after flush',
    )
    expect(wakeNudge?.content).toContain(
      'Summaries are below.',
    )
    expect(wakeNudge?.content).not.toContain('spawn_subagent tool results above')
    expect(wakeNudge?.content).toContain(
      'Subagent ledger:\n- explorer (sub-1): completed: steered rewrite after flush',
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
        '- explorer (sub-1): completed: mapped the repo',
        '- writer (sub-2): failed: boom',
        '- reviewer (sub-3): aborted: Stopped',
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

  it('finalizes a steered result after a stale user-turn snapshot is skipped', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    fail('sub-1', 'explorer timed out')
    const snapshot = listDeliverableBackgroundResults('chat-1')
    const stale = snapshot[0]
    if (!stale) {
      throw new Error('expected a deliverable failed result')
    }

    expect(reopen('sub-1', new AbortController())?.status).toBe('running')
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'steered rewrite',
    })
    const steered = listDeliverableBackgroundResults('chat-1')
    const steeredItem = steered[0]
    if (!steeredItem) {
      throw new Error('expected a deliverable steered result')
    }

    const priorOnEvent = vi.fn<() => void>()
    await finalizeBackgroundSpawnResults(
      'proj',
      'chat-1',
      snapshot,
      priorOnEvent,
      null,
    )
    expect(priorOnEvent).not.toHaveBeenCalled()
    expect(persistToolRun).not.toHaveBeenCalled()
    expect(isBackgroundResultFinalized('chat-1', 'tc-1')).toBe(false)

    const input = buildInput(steered)
    await resumeOrchestrator(input)

    expect(input.onEvent).toHaveBeenCalledWith({
      type: 'tool-result',
      toolCallId: 'tc-1',
      result: steeredItem.result,
      isError: false,
    })
    expect(persistToolRun).toHaveBeenCalledTimes(1)
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
      },
      steeredItem.result,
    )
    expect(isBackgroundResultFinalized('chat-1', 'tc-1')).toBe(true)
    const streamInput = runHarnessStream.mock.calls[0]?.[0]
    const modelMessages = streamInput?.modelMessages as Array<{
      role: string
      content: string
    }>
    const wakeNudge = modelMessages[modelMessages.length - 1]
    expect(wakeNudge?.content).toContain(
      '- explorer (sub-1, completed): steered rewrite',
    )
  })

  it('does not mark a steered snapshot delivered on resume', async () => {
    register('chat-1', 'sub-stale', new AbortController(), {
      toolCallId: 'tc-stale',
      agentName: 'explorer',
    })
    register('chat-1', 'sub-live', new AbortController(), {
      toolCallId: 'tc-live',
      agentName: 'writer',
    })
    fail('sub-stale', 'explorer timed out')
    resolve('sub-live', {
      subagentId: 'sub-live',
      name: 'writer',
      summary: 'drafted the patch',
    })
    const snapshot = listDeliverableBackgroundResults('chat-1')
    const stale = snapshot.find((item) => item.toolCallId === 'tc-stale')
    const live = snapshot.find((item) => item.toolCallId === 'tc-live')
    if (!stale || !live) {
      throw new Error('expected both deliverable results')
    }

    expect(reopen('sub-stale', new AbortController())?.status).toBe('running')
    resolve('sub-stale', {
      subagentId: 'sub-stale',
      name: 'explorer',
      summary: 'steered rewrite',
    })

    await resumeOrchestrator(buildInput([stale, live]))

    expect(isBackgroundResultDelivered('chat-1', 'tc-stale')).toBe(false)
    expect(isBackgroundResultDelivered('chat-1', 'tc-live')).toBe(true)
    expect(isBackgroundResultFinalized('chat-1', 'tc-stale')).toBe(false)
    expect(isBackgroundResultFinalized('chat-1', 'tc-live')).toBe(true)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-stale',
        result: {
          subagentId: 'sub-stale',
          name: 'explorer',
          summary: 'steered rewrite',
        },
      },
    ])

    const streamInput = runHarnessStream.mock.calls[0]?.[0]
    const modelMessages = streamInput?.modelMessages as Array<{
      role: string
      content: string
    }>
    const wakeNudge = modelMessages[modelMessages.length - 1]
    expect(wakeNudge?.content).toContain(
      '- writer (sub-live, completed): drafted the patch',
    )
    expect(wakeNudge?.content).not.toContain('explorer timed out')
    expect(wakeNudge?.content).not.toContain(
      '- explorer (sub-stale, completed): steered rewrite',
    )
    expect(wakeNudge?.content).toContain(
      '- explorer (sub-stale): completed: steered rewrite',
    )
  })

  it('omits the wake nudge when every resume snapshot was steered away', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    fail('sub-1', 'explorer timed out')
    const snapshot = listDeliverableBackgroundResults('chat-1')
    const stale = snapshot[0]
    if (!stale) {
      throw new Error('expected a deliverable failed result')
    }

    expect(reopen('sub-1', new AbortController())?.status).toBe('running')
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'steered rewrite',
    })

    await resumeOrchestrator(buildInput(snapshot))

    expect(isBackgroundResultDelivered('chat-1', 'tc-1')).toBe(false)
    expect(isBackgroundResultFinalized('chat-1', 'tc-1')).toBe(false)
    const streamInput = runHarnessStream.mock.calls[0]?.[0]
    const modelMessages = streamInput?.modelMessages as Array<{
      role: string
      content: unknown
    }>
    expect(
      modelMessages.some(
        (message) =>
          typeof message.content === 'string' &&
          message.content.includes('[harness: background subagent results]'),
      ),
    ).toBe(false)
  })

  it('does not re-emit spawn results already finalized on a failed user turn', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })
    const completedResults = listDeliverableBackgroundResults('chat-1')
    const priorOnEvent = vi.fn<() => void>()

    await finalizeBackgroundSpawnResults(
      'proj',
      'chat-1',
      completedResults,
      priorOnEvent,
      null,
    )
    expect(persistToolRun).toHaveBeenCalledTimes(1)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual(completedResults)

    const input = buildInput(completedResults)
    await resumeOrchestrator(input)

    expect(priorOnEvent).toHaveBeenCalledTimes(1)
    expect(input.onEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool-result',
        toolCallId: 'tc-1',
      }),
    )
    expect(persistToolRun).toHaveBeenCalledTimes(1)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])
    const streamInput = runHarnessStream.mock.calls[0]?.[0]
    const modelMessages = streamInput?.modelMessages as Array<{
      role: string
      content: string
    }>
    const wakeNudge = modelMessages[modelMessages.length - 1]
    expect(wakeNudge?.content).toContain('- explorer (sub-1, completed): mapped the repo')
  })

  it('includes the persisted spawn turn on a second resume after the snapshot is cleared', async () => {
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
    expect(getTurnResponseMessages('chat-1')).toBeNull()
    expect(persistLine).toHaveBeenCalled()

    resolve('sub-2', {
      subagentId: 'sub-2',
      name: 'writer',
      summary: 'drafted the patch',
    })
    await resumeOrchestrator(
      buildInput(listDeliverableBackgroundResults('chat-1')),
    )

    const second = runHarnessStream.mock.calls[1]?.[0]
    const modelMessages = second?.modelMessages as Array<{
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
    const wakes = modelMessages.filter(
      (message) =>
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.includes('[harness: background subagent results]'),
    )
    expect(wakes).toHaveLength(2)
  })

  it('delivers each staggered summary in exactly one completed block', async () => {
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
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })
    setTurnResponseMessages('chat-1', wave1Messages)

    await resumeOrchestrator(
      buildInput(listDeliverableBackgroundResults('chat-1')),
    )

    resolve('sub-2', {
      subagentId: 'sub-2',
      name: 'writer',
      summary: 'drafted the patch',
    })
    await resumeOrchestrator(
      buildInput(listDeliverableBackgroundResults('chat-1')),
    )

    resolve('sub-3', {
      subagentId: 'sub-3',
      name: 'reviewer',
      summary: 'reviewed the patch',
    })
    await resumeOrchestrator(
      buildInput(listDeliverableBackgroundResults('chat-1')),
    )

    const wakeContents = runHarnessStream.mock.calls.map((call) => {
      const modelMessages = call[0]?.modelMessages as Array<{
        role: string
        content: string
      }>
      return modelMessages
        .filter(
          (message) =>
            message.role === 'user' &&
            typeof message.content === 'string' &&
            message.content.includes('[harness: background subagent results]'),
        )
        .at(-1)?.content
    })
    expect(wakeContents[0]).toContain('- explorer (sub-1, completed): mapped the repo')
    expect(wakeContents[0]).not.toContain('- writer (sub-2, completed):')
    expect(wakeContents[0]).not.toContain('- reviewer (sub-3, completed):')
    expect(wakeContents[1]).toContain('- writer (sub-2, completed): drafted the patch')
    expect(wakeContents[1]).not.toContain('- explorer (sub-1, completed):')
    expect(wakeContents[1]).not.toContain('- reviewer (sub-3, completed):')
    expect(wakeContents[2]).toContain('- reviewer (sub-3, completed): reviewed the patch')
    expect(wakeContents[2]).not.toContain('- explorer (sub-1, completed):')
    expect(wakeContents[2]).not.toContain('- writer (sub-2, completed):')
    expect(wakeContents[2]).toContain(
      '- explorer (sub-1): completed: mapped the repo',
    )
    expect(wakeContents[2]).toContain(
      '- writer (sub-2): completed: drafted the patch',
    )
    expect(wakeContents[2]).toContain(
      '- reviewer (sub-3): completed: reviewed the patch',
    )
  })

  it('wakes again after reopen when the steered summary matches the first delivery', async () => {
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
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])

    expect(reopen('sub-1', new AbortController())?.status).toBe('running')
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })
    setTurnResponseMessages('chat-1', wave2Messages)

    const steered = listDeliverableBackgroundResults('chat-1')
    expect(steered).toEqual([
      {
        toolCallId: 'tc-1',
        result: {
          subagentId: 'sub-1',
          name: 'explorer',
          summary: 'mapped the repo',
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
    expect(wakeNudge?.role).toBe('user')
    expect(wakeNudge?.content).toContain('[harness: background subagent results]')
    expect(wakeNudge?.content).toContain(
      '- explorer (sub-1, completed): mapped the repo',
    )
  })

  it('resumes with only a shell result and includes the shell nudge', async () => {
    const shellResult = {
      toolCallId: 'tc-shell',
      shellId: 'sh-finished',
      command: 'npm test',
      description: 'Run tests',
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    }

    await resumeOrchestrator(
      buildInput([], { shellResults: [shellResult] }),
    )

    const streamInput = runHarnessStream.mock.calls[0]?.[0]
    const modelMessages = streamInput?.modelMessages as Array<{
      role: string
      content: string
    }>
    const wakeNudge = modelMessages[modelMessages.length - 1]
    expect(wakeNudge?.role).toBe('user')
    expect(wakeNudge?.content).toContain('[harness: background terminal results]')
    expect(wakeNudge?.content).toContain('sh-finished')
    expect(listDeliverableShellResults('chat-1')).toEqual([])
  })

  it('delivers an overlay-persisted shell result once after a failed user turn', async () => {
    type ExitListener = (event: {
      payload: { shellId: string; exitCode: number; signal?: number }
    }) => void
    let exitHandler: ExitListener | undefined
    listen.mockImplementation(async (event, handler) => {
      if (typeof event === 'string' && event.startsWith('shell-exit-')) {
        exitHandler = handler as ExitListener
      }
      return () => {}
    })

    const shell = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/tmp/proj',
      command: 'npm test',
      description: 'Run tests',
      toolCallId: 'tc-shell',
      background: true,
      wakeParent: true,
    })
    exitHandler?.({
      payload: { shellId: shell.shellId, exitCode: 0 },
    })

    const queued = listDeliverableShellResults('chat-1')
    const result = queued[0]
    if (!result) {
      throw new Error('expected a deliverable shell result')
    }
    const wakeContent = buildShellWakeNudge([result], [])
    await persistResumeOverlay({
      projectSlug: 'proj',
      chatId: 'chat-1',
      wake: {
        content: wakeContent,
        toolCallIds: [result.toolCallId],
        resultKeys: [shellResultKey(result)],
      },
    })
    expect(listDeliverableShellResults('chat-1')).toEqual([result])
    expect(hasPendingShellResume('chat-1')).toBe(true)

    await resumeOrchestrator(buildInput([], { shellResults: queued }))

    const streamInput = runHarnessStream.mock.calls[0]?.[0]
    const modelMessages = streamInput?.modelMessages as Array<{
      role: string
      content: string
    }>
    const shellNudges = modelMessages.filter(
      (message) =>
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.includes('[harness: background terminal results]'),
    )
    expect(shellNudges).toHaveLength(1)
    expect(shellNudges[0]?.content).toContain(shell.shellId)
    expect(listDeliverableShellResults('chat-1')).toEqual([])
    expect(hasPendingShellResume('chat-1')).toBe(false)

    await expect(
      resumeOrchestrator(
        buildInput([], {
          shellResults: listDeliverableShellResults('chat-1'),
        }),
      ),
    ).rejects.toThrow('No completed subagent results to resume')
  })

  it('appends an overlay-persisted shell nudge when captured turn messages skip overlay replay', async () => {
    type ExitListener = (event: {
      payload: { shellId: string; exitCode: number; signal?: number }
    }) => void
    let exitHandler: ExitListener | undefined
    listen.mockImplementation(async (event, handler) => {
      if (typeof event === 'string' && event.startsWith('shell-exit-')) {
        exitHandler = handler as ExitListener
      }
      return () => {}
    })

    const shell = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/tmp/proj',
      command: 'npm test',
      description: 'Run tests',
      toolCallId: 'tc-shell',
      background: true,
      wakeParent: true,
    })
    exitHandler?.({
      payload: { shellId: shell.shellId, exitCode: 0 },
    })

    const queued = listDeliverableShellResults('chat-1')
    const result = queued[0]
    if (!result) {
      throw new Error('expected a deliverable shell result')
    }
    await persistResumeOverlay({
      projectSlug: 'proj',
      chatId: 'chat-1',
      wake: {
        content: buildShellWakeNudge([result], []),
        toolCallIds: [result.toolCallId],
        resultKeys: [shellResultKey(result)],
      },
    })
    setTurnResponseMessages('chat-1', wave1Messages)

    await resumeOrchestrator(buildInput([], { shellResults: queued }))

    const streamInput = runHarnessStream.mock.calls[0]?.[0]
    const modelMessages = streamInput?.modelMessages as Array<{
      role: string
      content: string
    }>
    const shellNudges = modelMessages.filter(
      (message) =>
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.includes('[harness: background terminal results]'),
    )
    expect(shellNudges).toHaveLength(1)
    expect(shellNudges[0]?.content).toContain(shell.shellId)
    expect(listDeliverableShellResults('chat-1')).toEqual([])
  })

  it('names a still-running parent background shell in the resume nudge', async () => {
    const running = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/tmp/proj',
      command: 'npm run dev',
      background: true,
      wakeParent: true,
    })
    const shellResult = {
      toolCallId: 'tc-shell',
      shellId: 'sh-finished',
      command: 'npm test',
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    }

    await resumeOrchestrator(
      buildInput([], { shellResults: [shellResult] }),
    )

    const streamInput = runHarnessStream.mock.calls[0]?.[0]
    const modelMessages = streamInput?.modelMessages as Array<{
      role: string
      content: string
    }>
    const wakeNudge = modelMessages[modelMessages.length - 1]
    expect(wakeNudge?.content).toContain('Still running:')
    expect(wakeNudge?.content).toContain(running.shellId)
  })

  it('throws when resume has neither subagent nor shell results', async () => {
    await expect(resumeOrchestrator(buildInput([]))).rejects.toThrow(
      'No completed subagent results to resume',
    )
  })
})

