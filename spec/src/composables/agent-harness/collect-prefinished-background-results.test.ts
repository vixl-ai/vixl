import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockTauriEvent } from '../../test-utils/mocks/tauri-event'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

type ExitListener = (event: {
  payload: { shellId: string; exitCode: number; signal?: number }
}) => void

const listen = vi.hoisted(() =>
  vi.fn<(event: string, handler: ExitListener) => Promise<() => void>>(
    async () => () => {},
  ),
)

vi.mock('@tauri-apps/api/event', () => mockTauriEvent({ listen }))
vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri())

import collectPrefinishedBackgroundResults, {
  collectPrefinishedShellResults,
  commitPrefinishedBackgroundResults,
  commitPrefinishedShellResults,
} from '@/composables/agent-harness/collect-prefinished-background-results'
import {
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

describe('collectPrefinishedBackgroundResults', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetSubagentRegistryForTests()
    const { resetAgentShellRegistryForTests } = await import(
      '@/services/harness/shell/registry'
    )
    resetAgentShellRegistryForTests()
  })

  it('snapshots background results without marking blocking inline results delivered', () => {
    register(
      'chat-1',
      'block-1',
      new AbortController(),
      { toolCallId: 'tc-block', agentName: 'blocking' },
      { pendingResume: false },
    )
    register('chat-1', 'bg-1', new AbortController(), {
      toolCallId: 'tc-bg',
      agentName: 'explorer',
    })
    resolve('block-1', {
      subagentId: 'block-1',
      name: 'blocking',
      summary: 'inline done',
    })
    fail('bg-1', 'explorer timed out')

    const snapshot = collectPrefinishedBackgroundResults('chat-1', false, false)

    expect(snapshot).toEqual([
      {
        toolCallId: 'tc-bg',
        result: {
          subagentId: 'bg-1',
          name: 'explorer',
          summary: 'explorer timed out',
        },
      },
    ])
    expect(listDeliverableBackgroundResults('chat-1')).toEqual(snapshot)

    commitPrefinishedBackgroundResults('chat-1', snapshot)

    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])
    expect(hasPendingBackgroundResume('chat-1')).toBe(false)
  })

  it('does not swallow a result that was steered and re-finished during the user turn', () => {
    register('chat-1', 'bg-1', new AbortController(), {
      toolCallId: 'tc-bg',
      agentName: 'explorer',
    })
    fail('bg-1', 'explorer timed out')

    const snapshot = collectPrefinishedBackgroundResults('chat-1', false, false)
    expect(snapshot).toEqual([
      {
        toolCallId: 'tc-bg',
        result: {
          subagentId: 'bg-1',
          name: 'explorer',
          summary: 'explorer timed out',
        },
      },
    ])

    expect(reopen('bg-1', new AbortController())?.status).toBe('running')
    resolve('bg-1', {
      subagentId: 'bg-1',
      name: 'explorer',
      summary: 'steered rewrite',
    })

    commitPrefinishedBackgroundResults('chat-1', snapshot)

    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-bg',
        result: {
          subagentId: 'bg-1',
          name: 'explorer',
          summary: 'steered rewrite',
        },
      },
    ])
    expect(hasPendingBackgroundResume('chat-1')).toBe(true)
  })

  it('marks only unsteered snapshot results delivered when a sibling is reopened', () => {
    register('chat-1', 'bg-keep', new AbortController(), {
      toolCallId: 'tc-keep',
      agentName: 'keeper',
    })
    register('chat-1', 'bg-steer', new AbortController(), {
      toolCallId: 'tc-steer',
      agentName: 'explorer',
    })
    fail('bg-keep', 'keeper timed out')
    fail('bg-steer', 'explorer timed out')

    const snapshot = collectPrefinishedBackgroundResults('chat-1', false, false)
    expect(snapshot?.map((item) => item.toolCallId)).toEqual([
      'tc-keep',
      'tc-steer',
    ])

    expect(reopen('bg-steer', new AbortController())?.status).toBe('running')
    resolve('bg-steer', {
      subagentId: 'bg-steer',
      name: 'explorer',
      summary: 'steered rewrite',
    })

    commitPrefinishedBackgroundResults('chat-1', snapshot)

    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-steer',
        result: {
          subagentId: 'bg-steer',
          name: 'explorer',
          summary: 'steered rewrite',
        },
      },
    ])
    expect(hasPendingBackgroundResume('chat-1')).toBe(true)
  })
})

describe('collectPrefinishedShellResults', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { resetAgentShellRegistryForTests } = await import(
      '@/services/harness/shell/registry'
    )
    resetAgentShellRegistryForTests()
  })

  it('snapshots a queued parent background result and commits it after success', async () => {
    let exitHandler: ExitListener | undefined
    listen.mockImplementation(async (event, handler) => {
      if (event.startsWith('shell-exit-')) {
        exitHandler = handler
      }
      return () => {}
    })

    const {
      createAgentShell,
      hasPendingShellResume,
      listDeliverableShellResults,
    } = await import('@/services/harness/shell/registry')

    const shell = await createAgentShell({
      chatId: 'chat-1',
      projectRoot: '/project',
      command: 'npm test',
      toolCallId: 'tc-shell',
      background: true,
      wakeParent: true,
    })
    exitHandler?.({
      payload: { shellId: shell.shellId, exitCode: 0 },
    })

    const spawnSnapshot = [
      {
        role: 'tool' as const,
        content: [
          {
            type: 'tool-result' as const,
            toolCallId: 'tc-shell',
            toolName: 'run_terminal',
            output: { type: 'json' as const, value: { pending: true } },
          },
        ],
      },
    ]
    setTurnResponseMessages('chat-1', spawnSnapshot)

    const snapshot = collectPrefinishedShellResults('chat-1', false, false)
    expect(snapshot).toEqual([
      expect.objectContaining({
        toolCallId: 'tc-shell',
        shellId: shell.shellId,
        command: 'npm test',
        exitCode: 0,
      }),
    ])
    expect(listDeliverableShellResults('chat-1')).toEqual(snapshot)
    expect(hasPendingShellResume('chat-1')).toBe(true)
    expect(getTurnResponseMessages('chat-1')).toEqual(spawnSnapshot)

    commitPrefinishedShellResults('chat-1', snapshot)

    expect(listDeliverableShellResults('chat-1')).toEqual([])
    expect(hasPendingShellResume('chat-1')).toBe(false)
    expect(getTurnResponseMessages('chat-1')).toBeNull()
  })
})
