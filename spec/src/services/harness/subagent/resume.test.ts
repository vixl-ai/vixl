import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelMessage } from 'ai'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const runSubagentGenerate = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<string>>(),
)
const linkAbortSignal = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
const emitSubagentResult = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
const finishSubagentWithError = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => void>(),
)

vi.mock('@/services/harness/subagent/run-generate', () => ({
  default: (...args: unknown[]) => runSubagentGenerate(...args),
}))

vi.mock('@/utils/link-abort-signal', () => ({
  default: (...args: unknown[]) => linkAbortSignal(...args),
}))

vi.mock('@/services/harness/subagent/helpers', () => ({
  emitSubagentResult: (...args: unknown[]) => emitSubagentResult(...args),
  finishSubagentWithError: (...args: unknown[]) =>
    finishSubagentWithError(...args),
  sanitizeSubagentName: (name: string) => name,
}))

import resumeSubagent from '@/services/harness/subagent/resume'
import { noPoll, visibleStatus } from '@/services/harness/guidance'
import {
  getSubagent,
  listDeliverableBackgroundResults,
  markBackgroundResultsDelivered,
  register,
  resetSubagentRegistryForTests,
  resolve,
  setMessages,
} from '@/services/harness/subagent/registry'

const resumeNote = `Resume started in the background. ${noPoll} ${visibleStatus('steered')}`

const runningReturn = {
  subagentId: 'sub-1',
  name: 'explorer',
  status: 'running' as const,
  note: resumeNote,
}

const baseCtx = (): HarnessToolContext => ({
  projectRoot: '/tmp/project',
  projectSlug: 'project',
  chatId: 'chat-1',
  mode: 'agent',
  settings: { version: 1 } as VixlSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set(),
  sessionDenies: new Set(),
  sandboxEnabled: true,
  supportsVision: false,
  onPendingApproval: () => {},
  onHarnessEvent: () => {},
})

const seedCompleted = (messages?: ModelMessage[]): void => {
  register('chat-1', 'sub-1', new AbortController(), {
    toolCallId: 'tc-1',
    agentName: 'explorer',
    prompt: 'first task',
    model: 'local::qwen',
    capabilities: 'read-only',
  })
  if (messages) {
    setMessages('sub-1', messages)
  }
  resolve('sub-1', {
    subagentId: 'sub-1',
    name: 'explorer',
    summary: 'first summary',
  })
}

describe('resumeSubagent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSubagentRegistryForTests()
    runSubagentGenerate.mockResolvedValue('second summary')
  })

  it('returns running immediately, then completes generate in the background', async () => {
    const history: ModelMessage[] = [
      { role: 'user', content: 'first task' },
      { role: 'assistant', content: 'first summary' },
    ]
    seedCompleted(history)

    let releaseGenerate: ((value: string) => void) | undefined
    runSubagentGenerate.mockImplementation(
      () =>
        new Promise((resolveGenerate) => {
          releaseGenerate = resolveGenerate
        }),
    )

    const events: unknown[] = []
    const ctx = {
      ...baseCtx(),
      onHarnessEvent: (event: unknown) => {
        events.push(event)
      },
    }

    await expect(resumeSubagent(ctx, 'sub-1', 'keep going')).resolves.toEqual(
      runningReturn,
    )

    expect(getSubagent('sub-1')?.status).toBe('running')
    expect(emitSubagentResult).not.toHaveBeenCalled()
    expect(linkAbortSignal).not.toHaveBeenCalled()
    expect(runSubagentGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        subagentId: 'sub-1',
        messages: [...history, { role: 'user', content: 'keep going' }],
        model: 'local::qwen',
      }),
    )
    expect(events).toEqual([
      expect.objectContaining({
        type: 'subagent-start',
        subagentId: 'sub-1',
        toolCallId: 'tc-1',
        name: 'explorer',
        blocking: false,
        prompt: 'first task',
        model: 'local::qwen',
        capabilities: 'read-only',
      }),
      expect.objectContaining({
        type: 'subagent-event',
        subagentId: 'sub-1',
        event: { type: 'subagent-steer', message: 'keep going' },
      }),
    ])
    expect(events.some((event) =>
      typeof event === 'object'
      && event !== null
      && 'type' in event
      && event.type === 'pending-subagent',
    )).toBe(false)

    releaseGenerate?.('second summary')

    await vi.waitFor(() => {
      expect(getSubagent('sub-1')?.status).toBe('completed')
    })
    expect(emitSubagentResult).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        subagentId: 'sub-1',
        summary: 'second summary',
        blocking: false,
        outcome: 'completed',
      }),
    )
    expect(emitSubagentResult).toHaveBeenCalledTimes(1)
  })

  it('continues resume from compacted history stored on the record', async () => {
    const compacted: ModelMessage[] = [
      { role: 'user', content: 'compacted checkpoint' },
    ]
    seedCompleted(compacted)

    await resumeSubagent(baseCtx(), 'sub-1', 'keep going')

    expect(runSubagentGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        subagentId: 'sub-1',
        messages: [...compacted, { role: 'user', content: 'keep going' }],
      }),
    )
  })

  it('rejects resume unless the subagent is completed or failed', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
      model: 'local::qwen',
    })

    await expect(resumeSubagent(baseCtx(), 'sub-1', 'nope')).rejects.toThrow(
      'Subagent cannot be resumed: sub-1',
    )
    expect(runSubagentGenerate).not.toHaveBeenCalled()
  })

  it('throws when the subagent is unknown', async () => {
    await expect(
      resumeSubagent(baseCtx(), 'missing', 'keep going'),
    ).rejects.toThrow('Subagent not found: missing')
    expect(runSubagentGenerate).not.toHaveBeenCalled()
  })

  it('throws when the subagent has no stored model', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'first summary',
    })

    await expect(
      resumeSubagent(baseCtx(), 'sub-1', 'keep going'),
    ).rejects.toThrow('Subagent has no stored model: sub-1')
    expect(runSubagentGenerate).not.toHaveBeenCalled()
    expect(getSubagent('sub-1')?.status).toBe('completed')
  })

  it('does not throw after delivery starts when generate fails', async () => {
    seedCompleted()

    let rejectGenerate: ((reason: Error) => void) | undefined
    runSubagentGenerate.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectGenerate = reject
        }),
    )

    const ctx = baseCtx()
    await expect(resumeSubagent(ctx, 'sub-1', 'keep going')).resolves.toEqual(
      runningReturn,
    )
    expect(finishSubagentWithError).not.toHaveBeenCalled()

    rejectGenerate?.(new Error('generate failed'))

    await vi.waitFor(() => {
      expect(finishSubagentWithError).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          subagentId: 'sub-1',
          blocking: false,
          aborted: false,
        }),
      )
    })
    expect(finishSubagentWithError).toHaveBeenCalledTimes(1)
    expect(emitSubagentResult).not.toHaveBeenCalled()
  })

  it('makes the steered summary deliverable after a prior parent flush', async () => {
    seedCompleted()
    markBackgroundResultsDelivered('chat-1', ['tc-1'])
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])

    let releaseGenerate: ((value: string) => void) | undefined
    runSubagentGenerate.mockImplementation(
      () =>
        new Promise((resolveGenerate) => {
          releaseGenerate = resolveGenerate
        }),
    )

    await resumeSubagent(baseCtx(), 'sub-1', 'keep going')
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])

    releaseGenerate?.('second summary')

    await vi.waitFor(() => {
      expect(listDeliverableBackgroundResults('chat-1')).toEqual([
        {
          toolCallId: 'tc-1',
          result: {
            subagentId: 'sub-1',
            name: 'explorer',
            summary: 'second summary',
          },
        },
      ])
    })
  })
})
