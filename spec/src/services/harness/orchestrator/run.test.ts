import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import type { OrchestratorInput } from '@/types/harness/orchestrator-input'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import { mockTauriEvent } from '../../../test-utils/mocks/tauri-event'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

vi.mock('@tauri-apps/api/event', () => mockTauriEvent())

const persistLine = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)
const persistToolRun = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)
const runHarnessStream = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)
const runSideTask = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<string | null>>().mockResolvedValue(null),
)
const convertToModelMessages = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]),
)

vi.mock('@/services/harness/orchestrator/persistence', () => ({
  persistLine: (...args: unknown[]) => persistLine(...args),
  persistToolRun: (...args: unknown[]) => persistToolRun(...args),
}))

vi.mock('@/services/harness/orchestrator/stream', () => ({
  default: (...args: unknown[]) => runHarnessStream(...args),
}))

vi.mock('@/services/harness/run-side-task', () => ({
  default: (...args: unknown[]) => runSideTask(...args),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    convertToModelMessages: (...args: unknown[]) =>
      convertToModelMessages(...args),
  }
})

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    readChatMeta: vi.fn<() => Promise<unknown>>().mockResolvedValue(null),
  }),
)

vi.mock('@/services/providers/create-model', () => ({
  default: vi.fn<() => Promise<{ id: string }>>(async () => ({ id: 'stub-model' })),
}))

vi.mock('@/services/harness/resolve-model-vision', () => ({
  default: vi.fn<() => Promise<boolean>>(async () => true),
}))

import { visibleStatus } from '@/services/harness/guidance'
import runOrchestrator from '@/services/harness/orchestrator/run'
import resetResumeOverlay from '@/services/harness/orchestrator/reset-resume-overlay'
import { resetAgentShellRegistryForTests } from '@/services/harness/shell/registry'
import {
  fail,
  isBackgroundResultFinalized,
  listDeliverableBackgroundResults,
  markBackgroundResultsDelivered,
  register,
  reopen,
  resetSubagentRegistryForTests,
  resolve,
} from '@/services/harness/subagent/registry'

const filePart = {
  type: 'file' as const,
  mediaType: 'image/png',
  url: 'data:image/png;base64,AAA',
  filename: 'shot.png',
}

const imageOnlyUser: UIMessage = {
  id: 'user-1',
  role: 'user',
  parts: [filePart],
  metadata: {
    createdAt: '2026-01-01T00:00:00.000Z',
    model: 'openai::gpt-4o',
  },
}

const buildInput = (
  overrides: Partial<OrchestratorInput> = {},
): OrchestratorInput =>
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
    messages: [imageOnlyUser],
    userText: '',
    mentions: [],
    signal: new AbortController().signal,
    onEvent: vi.fn<(...args: unknown[]) => void>(),
    sessionAllows: new Set<string>(),
    sessionDenies: new Set<string>(),
    ...overrides,
  }) as OrchestratorInput

describe('orchestrator run user persist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSubagentRegistryForTests()
    resetAgentShellRegistryForTests()
    resetResumeOverlay()
    persistLine.mockResolvedValue(undefined)
    persistToolRun.mockResolvedValue(undefined)
    runHarnessStream.mockResolvedValue(undefined)
    runSideTask.mockResolvedValue(null)
    convertToModelMessages.mockResolvedValue([])
  })

  it('persists image-only file parts when looking up the appended message by id', async () => {
    await runOrchestrator(
      buildInput({
        appendedUserMessageId: 'user-1',
        userText: '',
      }),
    )

    expect(persistLine).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      expect.objectContaining({
        id: 'user-1',
        role: 'user',
        parts: [filePart],
      }),
    )
    const persisted = persistLine.mock.calls[0]?.[2] as {
      parts: Array<{ type: string; text?: string }>
    }
    expect(persisted.parts.some((part) => part.type === 'text')).toBe(false)
  })

  it('falls back to text match when no appended message id is provided', async () => {
    const textUser: UIMessage = {
      id: 'user-text',
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
    }

    await runOrchestrator(
      buildInput({
        messages: [textUser],
        userText: 'hello',
      }),
    )

    expect(persistLine).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      expect.objectContaining({
        id: 'user-text',
        parts: [{ type: 'text', text: 'hello' }],
      }),
    )
  })

  it('skips title generation for an image-only first message', async () => {
    await runOrchestrator(
      buildInput({
        appendedUserMessageId: 'user-1',
        userText: '',
      }),
    )

    expect(runSideTask).not.toHaveBeenCalled()
  })

  it('appends an inline wake nudge for already-failed background results on a user turn', async () => {
    register('chat-1', 'sub-fail', new AbortController(), {
      toolCallId: 'tc-fail',
      agentName: 'explorer',
    })
    register('chat-1', 'sub-run', new AbortController(), {
      toolCallId: 'tc-run',
      agentName: 'writer',
    })
    fail('sub-fail', 'explorer timed out')
    const failedResult = listDeliverableBackgroundResults('chat-1')[0]
    if (!failedResult) {
      throw new Error('expected a deliverable failed result')
    }
    markBackgroundResultsDelivered('chat-1', [failedResult.toolCallId])

    const input = buildInput({
      appendedUserMessageId: 'user-1',
      userText: '',
      prefinishedBackgroundResults: [failedResult],
    })
    await runOrchestrator(input)

    const streamInput = runHarnessStream.mock.calls[0]?.[0] as {
      modelMessages: Array<{ role: string; content: string }>
    }
    const wakeNudge = streamInput.modelMessages[streamInput.modelMessages.length - 1]
    expect(wakeNudge?.role).toBe('user')
    expect(wakeNudge?.content).toContain('[harness: background subagent results]')
    expect(wakeNudge?.content).not.toContain('spawn_subagent tool results above')
    expect(wakeNudge?.content).toContain(
      '- explorer (sub-fail, failed): explorer timed out',
    )
    expect(wakeNudge?.content).toContain('still running: writer (sub-run)')
    expect(wakeNudge?.content).toContain(visibleStatus('finished'))
    expect(input.onEvent).toHaveBeenCalledWith({
      type: 'tool-result',
      toolCallId: 'tc-fail',
      result: failedResult.result,
      isError: false,
    })
    expect(persistToolRun).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      'tc-fail',
      'spawn_subagent',
      'done',
      '',
      {
        agentName: 'explorer',
        blocking: false,
      },
      failedResult.result,
    )
    expect(persistToolRun).toHaveBeenCalledTimes(1)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])

    fail('sub-run', 'writer failed')
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-run',
        result: {
          subagentId: 'sub-run',
          name: 'writer',
          summary: 'writer failed',
        },
      },
    ])
  })

  it('inlines summaries on a user turn when every background subagent has already finished', async () => {
    register('chat-1', 'sub-fail', new AbortController(), {
      toolCallId: 'tc-fail',
      agentName: 'explorer',
    })
    fail('sub-fail', 'explorer timed out')
    const failedResult = listDeliverableBackgroundResults('chat-1')[0]
    if (!failedResult) {
      throw new Error('expected a deliverable failed result')
    }

    await runOrchestrator(
      buildInput({
        appendedUserMessageId: 'user-1',
        userText: '',
        prefinishedBackgroundResults: [failedResult],
      }),
    )

    const streamInput = runHarnessStream.mock.calls[0]?.[0] as {
      modelMessages: Array<{ role: string; content: string }>
    }
    const wakeNudge = streamInput.modelMessages[streamInput.modelMessages.length - 1]
    expect(wakeNudge?.content).toContain('Summaries are below.')
    expect(wakeNudge?.content).not.toContain('spawn_subagent tool results above')
    expect(wakeNudge?.content).toContain(
      '- explorer (sub-fail, failed): explorer timed out',
    )
  })

  it('persists spawn args from the registry when turn messages were flushed', async () => {
    register('chat-1', 'sub-fail', new AbortController(), {
      toolCallId: 'tc-fail',
      agentName: 'explorer',
      prompt: 'map the repo',
      capabilities: 'read-only',
    })
    fail('sub-fail', 'explorer timed out')
    const failedResult = listDeliverableBackgroundResults('chat-1')[0]
    if (!failedResult) {
      throw new Error('expected a deliverable failed result')
    }

    const input = buildInput({
      appendedUserMessageId: 'user-1',
      userText: '',
      prefinishedBackgroundResults: [failedResult],
    })
    await runOrchestrator(input)

    expect(input.onEvent).toHaveBeenCalledWith({
      type: 'tool-result',
      toolCallId: 'tc-fail',
      result: failedResult.result,
      isError: false,
    })
    expect(persistToolRun).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      'tc-fail',
      'spawn_subagent',
      'done',
      '',
      {
        agentName: 'explorer',
        blocking: false,
        prompt: 'map the repo',
        capabilities: 'read-only',
      },
      failedResult.result,
    )
  })

  it('does not re-emit prefinished results when a failed user turn is retried', async () => {
    register('chat-1', 'sub-fail', new AbortController(), {
      toolCallId: 'tc-fail',
      agentName: 'explorer',
    })
    fail('sub-fail', 'explorer timed out')
    const failedResult = listDeliverableBackgroundResults('chat-1')[0]
    if (!failedResult) {
      throw new Error('expected a deliverable failed result')
    }

    runHarnessStream.mockRejectedValueOnce(new Error('provider down'))
    const input = buildInput({
      appendedUserMessageId: 'user-1',
      userText: '',
      skipUserPersist: true,
      prefinishedBackgroundResults: [failedResult],
    })

    await expect(runOrchestrator(input)).rejects.toThrow('provider down')
    expect(input.onEvent).toHaveBeenCalledTimes(1)
    expect(input.onEvent).toHaveBeenCalledWith({
      type: 'tool-result',
      toolCallId: 'tc-fail',
      result: failedResult.result,
      isError: false,
    })
    expect(persistToolRun).toHaveBeenCalledTimes(1)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([failedResult])

    await runOrchestrator(input)

    expect(input.onEvent).toHaveBeenCalledTimes(1)
    expect(persistToolRun).toHaveBeenCalledTimes(1)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([failedResult])
    const streamInput = runHarnessStream.mock.calls[1]?.[0] as {
      modelMessages: Array<{ role: string; content: string }>
    }
    const wakeNudge = streamInput.modelMessages[streamInput.modelMessages.length - 1]
    expect(wakeNudge?.role).toBe('user')
    expect(wakeNudge?.content).toContain(
      '- explorer (sub-fail, failed): explorer timed out',
    )
  })

  it('does not persist a steered-away snapshot on a user turn', async () => {
    register('chat-1', 'sub-fail', new AbortController(), {
      toolCallId: 'tc-fail',
      agentName: 'explorer',
    })
    fail('sub-fail', 'explorer timed out')
    const snapshot = listDeliverableBackgroundResults('chat-1')
    const stale = snapshot[0]
    if (!stale) {
      throw new Error('expected a deliverable failed result')
    }

    expect(reopen('sub-fail', new AbortController())?.status).toBe('running')
    resolve('sub-fail', {
      subagentId: 'sub-fail',
      name: 'explorer',
      summary: 'steered rewrite',
    })

    const input = buildInput({
      appendedUserMessageId: 'user-1',
      userText: '',
      prefinishedBackgroundResults: [stale],
    })
    await runOrchestrator(input)

    expect(input.onEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool-result',
        toolCallId: 'tc-fail',
      }),
    )
    expect(persistToolRun).not.toHaveBeenCalled()
    expect(isBackgroundResultFinalized('chat-1', 'tc-fail')).toBe(false)
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-fail',
        result: {
          subagentId: 'sub-fail',
          name: 'explorer',
          summary: 'steered rewrite',
        },
      },
    ])
    const streamInput = runHarnessStream.mock.calls[0]?.[0] as {
      modelMessages: Array<{ role: string; content: unknown }>
    }
    expect(
      streamInput.modelMessages.some(
        (message) =>
          typeof message.content === 'string' &&
          message.content.includes('[harness: background subagent results]'),
      ),
    ).toBe(false)
  })

  it('builds the inline wake nudge only from actually finalized prefinished results', async () => {
    register('chat-1', 'sub-stale', new AbortController(), {
      toolCallId: 'tc-stale',
      agentName: 'explorer',
    })
    register('chat-1', 'sub-live', new AbortController(), {
      toolCallId: 'tc-live',
      agentName: 'writer',
    })
    fail('sub-stale', 'explorer timed out')
    fail('sub-live', 'writer failed')
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

    await runOrchestrator(
      buildInput({
        appendedUserMessageId: 'user-1',
        userText: '',
        prefinishedBackgroundResults: [stale, live],
      }),
    )

    const streamInput = runHarnessStream.mock.calls[0]?.[0] as {
      modelMessages: Array<{ role: string; content: string }>
    }
    const wakeNudge = streamInput.modelMessages[streamInput.modelMessages.length - 1]
    expect(wakeNudge?.content).toContain('[harness: background subagent results]')
    expect(wakeNudge?.content).toContain(
      '- writer (sub-live, failed): writer failed',
    )
    expect(wakeNudge?.content).not.toContain('explorer timed out')
    expect(wakeNudge?.content).not.toContain(
      '- explorer (sub-stale, completed): steered rewrite',
    )
    expect(wakeNudge?.content).toContain(
      '- explorer (sub-stale): completed: steered rewrite',
    )
    expect(isBackgroundResultFinalized('chat-1', 'tc-stale')).toBe(false)
    expect(isBackgroundResultFinalized('chat-1', 'tc-live')).toBe(true)
  })

  it('does not append a wake nudge when there are no prefinished background results', async () => {
    convertToModelMessages.mockResolvedValue([
      { role: 'user', content: 'hello' },
    ])

    await runOrchestrator(
      buildInput({
        appendedUserMessageId: 'user-1',
        userText: '',
      }),
    )

    const streamInput = runHarnessStream.mock.calls[0]?.[0] as {
      modelMessages: Array<{ role: string; content: unknown }>
    }
    expect(streamInput.modelMessages).toEqual([
      { role: 'user', content: 'hello' },
    ])
    expect(
      streamInput.modelMessages.some(
        (message) =>
          typeof message.content === 'string' &&
          message.content.includes('[harness: background subagent results]'),
      ),
    ).toBe(false)
    expect(persistToolRun).not.toHaveBeenCalled()
  })

  it('appends a shell wake nudge for prefinished background terminal results on a user turn', async () => {
    const shellResult = {
      toolCallId: 'tc-shell',
      shellId: 'sh-finished',
      command: 'npm test',
      description: 'Run tests',
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    }

    await runOrchestrator(
      buildInput({
        appendedUserMessageId: 'user-1',
        userText: '',
        prefinishedShellResults: [shellResult],
      }),
    )

    const streamInput = runHarnessStream.mock.calls[0]?.[0] as {
      modelMessages: Array<{ role: string; content: string }>
    }
    const wakeNudge = streamInput.modelMessages[streamInput.modelMessages.length - 1]
    expect(wakeNudge?.role).toBe('user')
    expect(wakeNudge?.content).toContain('[harness: background terminal results]')
    expect(wakeNudge?.content).toContain('sh-finished')
  })
})
