import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const { metaFor, runSubagentGenerate } = vi.hoisted(() => {
  const metaFor = (id: string) => ({
    id,
    title: id,
    projectSlug: 'proj',
    projectRoot: '/proj',
    mode: 'agent' as const,
    model: 'test/model',
    status: 'idle' as const,
    attention: null,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    forkedFrom: null,
    pinned: false,
    pinnedAt: null,
  })
  const runSubagentGenerate = vi.fn<
    (...args: unknown[]) => Promise<{ text: string; finishReason?: string }>
  >()
  return { metaFor, runSubagentGenerate }
})

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    readChatMeta: vi.fn<
      (_slug: string, chatId: string) => Promise<ReturnType<typeof metaFor>>
    >(async (_slug, chatId) => metaFor(chatId)),
    readChatMessages: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  }),
)

vi.mock('@/services/harness/subagent/run-generate', () => ({
  default: (...args: unknown[]) => runSubagentGenerate(...args),
}))

const harnessLine = (
  id: string,
  harnessEvent: Record<string, unknown>,
  createdAt = '2020-01-01T00:00:00.000Z',
) => ({
  id,
  role: 'assistant' as const,
  parts: [],
  createdAt,
  harnessEvent,
})

const snapshotMessages = [
  { role: 'user' as const, content: 'look around' },
  { role: 'assistant' as const, content: 'still looking' },
]

const hydrateCtx = (chatId: string): HarnessToolContext => ({
  projectRoot: '/proj',
  projectSlug: 'proj',
  chatId,
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

describe('hydrateSessionFromDisk unfinished subagents', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    runSubagentGenerate.mockResolvedValue({
      text: 'resumed',
      finishReason: 'stop',
    })
    const { resetSubagentRegistryForTests } = await import(
      '@/services/harness/subagent/registry'
    )
    resetSubagentRegistryForTests()
  })

  it('marks a running subagent as error and closes leftover running tools', async () => {
    const vixl = await import('@/services/vixl/vixl-tauri')
    vi.mocked(vixl.readChatMessages).mockResolvedValue([
      harnessLine('sub-1', {
        type: 'subagent-start',
        subagentId: 'sub-1',
        name: 'explore',
        blocking: false,
      }),
      harnessLine('sub-1-event-1', {
        type: 'subagent-event',
        subagentId: 'sub-1',
        event: {
          type: 'tool-start',
          toolCallId: 't-running',
          name: 'read_file',
          args: { path: 'a.ts' },
        },
      }),
      harnessLine('sub-1-event-2', {
        type: 'subagent-event',
        subagentId: 'sub-1',
        event: {
          type: 'tool-start',
          toolCallId: 't-done',
          name: 'read_file',
          args: { path: 'b.ts' },
        },
      }),
      harnessLine('sub-1-event-3', {
        type: 'subagent-event',
        subagentId: 'sub-1',
        event: {
          type: 'tool-result',
          toolCallId: 't-done',
          result: { content: 'ok' },
          isError: false,
        },
      }),
    ])

    const { createSession } = await import('@/composables/chat-store/helpers')
    const hydrateSessionFromDisk = (await import('@/composables/chat-store/hydrate'))
      .default
    const session = createSession('proj', 'chat-hydrate-subagent')
    await hydrateSessionFromDisk(session)

    const item = session.timeline.value[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.status).toBe('error')
    expect(item.summary).toBe(
      'Interrupted when the app closed. Steer this subagent to resume.',
    )
    expect(item.tools).toEqual([
      {
        toolCallId: 't-running',
        name: 'read_file',
        status: 'error',
        args: { path: 'a.ts' },
        result: { error: 'Tool did not complete' },
      },
      {
        toolCallId: 't-done',
        name: 'read_file',
        status: 'done',
        args: { path: 'b.ts' },
        result: { content: 'ok' },
      },
    ])
  })

  it('leaves a completed subagent at its persisted terminal status', async () => {
    const vixl = await import('@/services/vixl/vixl-tauri')
    vi.mocked(vixl.readChatMessages).mockResolvedValue([
      harnessLine('sub-1', {
        type: 'subagent-start',
        subagentId: 'sub-1',
        name: 'explore',
        blocking: false,
      }),
      harnessLine('sub-1-result', {
        type: 'subagent-result',
        subagentId: 'sub-1',
        summary: 'found things',
        outcome: 'completed',
      }),
    ])

    const { createSession } = await import('@/composables/chat-store/helpers')
    const hydrateSessionFromDisk = (await import('@/composables/chat-store/hydrate'))
      .default
    const session = createSession('proj', 'chat-hydrate-done')
    await hydrateSessionFromDisk(session)

    const item = session.timeline.value[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.status).toBe('done')
    expect(item.summary).toBe('found things')
  })

  it('restores an interrupted registry record and resumes from the snapshot', async () => {
    const vixl = await import('@/services/vixl/vixl-tauri')
    vi.mocked(vixl.readChatMessages).mockResolvedValue([
      harnessLine('sub-1', {
        type: 'subagent-start',
        subagentId: 'sub-1',
        toolCallId: 'tc-1',
        name: 'explorer',
        blocking: false,
        prompt: 'look around',
        model: 'local::qwen',
        capabilities: 'write',
        workspace: { projectRoot: '/tmp/wt', projectSlug: 'feature' },
      }),
      harnessLine('subagent-resume:sub-1', {
        type: 'subagent-resume',
        subagentId: 'sub-1',
        toolCallId: 'tc-1',
        agentName: 'explorer',
        blocking: false,
        prompt: 'look around',
        model: 'local::qwen',
        capabilities: 'write',
        workspace: { projectRoot: '/tmp/wt', projectSlug: 'feature' },
        messages: snapshotMessages,
      }),
      harnessLine('sub-1-event-1', {
        type: 'subagent-event',
        subagentId: 'sub-1',
        event: {
          type: 'tool-start',
          toolCallId: 't-later',
          name: 'read_file',
          args: { path: 'a.ts' },
        },
      }),
    ])

    const { createSession } = await import('@/composables/chat-store/helpers')
    const hydrateSessionFromDisk = (await import('@/composables/chat-store/hydrate'))
      .default
    const session = createSession('proj', 'chat-hydrate-resume')
    await hydrateSessionFromDisk(session)

    const item = session.timeline.value[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.status).toBe('error')
    expect(item.summary).toBe(
      'Interrupted when the app closed. Steer this subagent to resume.',
    )
    expect(item.messages).toEqual(snapshotMessages)
    expect(item.capabilities).toBe('write')
    expect(item.workspace).toEqual({
      projectRoot: '/tmp/wt',
      projectSlug: 'feature',
    })
    expect(item.startedAt).toBe('2020-01-01T00:00:00.000Z')
    expect(item.blocking).toBe(false)

    const { getSubagent, isBackgroundSubagent } = await import(
      '@/services/harness/subagent/registry'
    )
    const { isBlockingOriginSubagent } = await import(
      '@/services/harness/subagent/blocking-origin-sets'
    )
    const record = getSubagent('sub-1')
    expect(record?.status).toBe('interrupted')
    expect(record?.messages).toEqual(snapshotMessages)
    expect(record?.model).toBe('local::qwen')
    expect(record?.capabilities).toBe('write')
    expect(record?.workspace).toEqual({
      projectRoot: '/tmp/wt',
      projectSlug: 'feature',
    })
    expect(record?.startedAt).toBe('2020-01-01T00:00:00.000Z')
    expect(isBlockingOriginSubagent('sub-1')).toBe(false)

    const steerSubagent = (await import('@/services/harness/subagent/steer'))
      .default
    const runner = steerSubagent(hydrateCtx('chat-hydrate-resume')).execute as (
      value: Record<string, unknown>,
      options: { toolCallId: string },
    ) => Promise<unknown>
    await expect(
      runner(
        { subagentId: 'sub-1', agentName: 'explorer', message: 'keep going' },
        { toolCallId: 'steer-1' },
      ),
    ).resolves.toMatchObject({
      subagentId: 'sub-1',
      accepted: true,
    })
    expect(runSubagentGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        subagentId: 'sub-1',
        messages: [...snapshotMessages, { role: 'user', content: 'keep going' }],
        model: 'local::qwen',
        capabilities: 'write',
        workspace: { projectRoot: '/tmp/wt', projectSlug: 'feature' },
      }),
    )
    expect(isBackgroundSubagent('sub-1')).toBe(true)
  })

  it('keeps a blocking-origin spawn blocking after a later non-blocking start', async () => {
    const vixl = await import('@/services/vixl/vixl-tauri')
    vi.mocked(vixl.readChatMessages).mockResolvedValue([
      harnessLine('sub-1', {
        type: 'subagent-start',
        subagentId: 'sub-1',
        toolCallId: 'tc-1',
        name: 'explorer',
        blocking: true,
        prompt: 'look around',
        model: 'local::qwen',
        capabilities: 'write',
      }),
      harnessLine('sub-1-resume-start', {
        type: 'subagent-start',
        subagentId: 'sub-1',
        toolCallId: 'tc-1',
        name: 'explorer',
        blocking: false,
        prompt: 'look around',
        model: 'local::qwen',
        capabilities: 'write',
      }),
      harnessLine('subagent-resume:sub-1', {
        type: 'subagent-resume',
        subagentId: 'sub-1',
        toolCallId: 'tc-1',
        agentName: 'explorer',
        blocking: true,
        prompt: 'look around',
        model: 'local::qwen',
        capabilities: 'write',
        messages: snapshotMessages,
      }),
    ])

    const { createSession } = await import('@/composables/chat-store/helpers')
    const hydrateSessionFromDisk = (await import('@/composables/chat-store/hydrate'))
      .default
    const session = createSession('proj', 'chat-hydrate-blocking-origin')
    await hydrateSessionFromDisk(session)

    const item = session.timeline.value[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.blocking).toBe(true)
    expect(item.status).toBe('error')
    expect(item.messages).toEqual(snapshotMessages)

    const {
      isBackgroundSubagent,
      listDeliverableBackgroundResults,
      reopen,
      resetSubagentRegistryForTests,
      resolve,
    } = await import('@/services/harness/subagent/registry')
    const { isBlockingOriginSubagent } = await import(
      '@/services/harness/subagent/blocking-origin-sets'
    )
    expect(isBlockingOriginSubagent('sub-1')).toBe(true)
    expect(isBackgroundSubagent('sub-1')).toBe(false)
    expect(listDeliverableBackgroundResults('chat-hydrate-blocking-origin')).toEqual(
      [],
    )

    expect(reopen('sub-1', new AbortController())?.status).toBe('running')
    expect(listDeliverableBackgroundResults('chat-hydrate-blocking-origin')).toEqual(
      [],
    )
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'steered',
    })
    expect(isBlockingOriginSubagent('sub-1')).toBe(true)
    expect(isBackgroundSubagent('sub-1')).toBe(false)
    expect(listDeliverableBackgroundResults('chat-hydrate-blocking-origin')).toEqual([
      {
        toolCallId: 'tc-1',
        result: {
          subagentId: 'sub-1',
          name: 'explorer',
          summary: 'steered',
        },
      },
    ])
    resetSubagentRegistryForTests()
  })

  it('keeps the latest snapshot messages when later events follow the resume line', async () => {
    const vixl = await import('@/services/vixl/vixl-tauri')
    vi.mocked(vixl.readChatMessages).mockResolvedValue([
      harnessLine('sub-1', {
        type: 'subagent-start',
        subagentId: 'sub-1',
        name: 'explorer',
        blocking: false,
        prompt: 'look around',
        model: 'local::qwen',
      }),
      harnessLine('subagent-resume:sub-1', {
        type: 'subagent-resume',
        subagentId: 'sub-1',
        toolCallId: 'tc-1',
        agentName: 'explorer',
        blocking: false,
        prompt: 'look around',
        model: 'local::qwen',
        capabilities: 'read-only',
        messages: snapshotMessages,
      }),
      harnessLine('sub-1-history', {
        type: 'subagent-event',
        subagentId: 'sub-1',
        event: {
          type: 'subagent-history',
          messages: [{ role: 'user', content: 'stale' }],
        },
      }),
      harnessLine('sub-1-step', {
        type: 'subagent-event',
        subagentId: 'sub-1',
        event: {
          type: 'step-content',
          stepId: 's1',
          reasoning: '',
          reasoningSeconds: 0,
          text: 'later step',
        },
      }),
    ])

    const { createSession } = await import('@/composables/chat-store/helpers')
    const hydrateSessionFromDisk = (await import('@/composables/chat-store/hydrate'))
      .default
    const session = createSession('proj', 'chat-hydrate-resume-latest')
    await hydrateSessionFromDisk(session)

    const item = session.timeline.value[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.messages).toEqual(snapshotMessages)
  })

  it('keeps history messages when the history line createdAt is newer than resume', async () => {
    const historyMessages = [
      { role: 'user' as const, content: 'look around' },
      { role: 'assistant' as const, content: 'final step' },
    ]
    const vixl = await import('@/services/vixl/vixl-tauri')
    vi.mocked(vixl.readChatMessages).mockResolvedValue([
      harnessLine('sub-1', {
        type: 'subagent-start',
        subagentId: 'sub-1',
        name: 'explorer',
        blocking: false,
        prompt: 'look around',
        model: 'local::qwen',
      }),
      harnessLine(
        'subagent-resume:sub-1',
        {
          type: 'subagent-resume',
          subagentId: 'sub-1',
          toolCallId: 'tc-1',
          agentName: 'explorer',
          blocking: false,
          prompt: 'look around',
          model: 'local::qwen',
          capabilities: 'read-only',
          workspace: { projectRoot: '/tmp/wt', projectSlug: 'feature' },
          messages: snapshotMessages,
        },
        '2020-01-01T00:00:01.000Z',
      ),
      harnessLine(
        'sub-1-history',
        {
          type: 'subagent-event',
          subagentId: 'sub-1',
          event: {
            type: 'subagent-history',
            messages: historyMessages,
          },
        },
        '2020-01-01T00:00:02.000Z',
      ),
    ])

    const { createSession } = await import('@/composables/chat-store/helpers')
    const hydrateSessionFromDisk = (await import('@/composables/chat-store/hydrate'))
      .default
    const session = createSession('proj', 'chat-hydrate-history-newer')
    await hydrateSessionFromDisk(session)

    const item = session.timeline.value[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.messages).toEqual(historyMessages)
    expect(item.model).toBe('local::qwen')
    expect(item.capabilities).toBe('read-only')
    expect(item.workspace).toEqual({
      projectRoot: '/tmp/wt',
      projectSlug: 'feature',
    })
  })

  it('uses timestamped history messages when a later untimestamped history line follows', async () => {
    const historyMessages = [
      { role: 'user' as const, content: 'look around' },
      { role: 'assistant' as const, content: 'final step' },
    ]
    const tailMessages = [{ role: 'user' as const, content: 'untimestamped tail' }]
    const vixl = await import('@/services/vixl/vixl-tauri')
    vi.mocked(vixl.readChatMessages).mockResolvedValue([
      harnessLine('sub-1', {
        type: 'subagent-start',
        subagentId: 'sub-1',
        name: 'explorer',
        blocking: false,
        prompt: 'look around',
        model: 'local::qwen',
      }),
      harnessLine(
        'subagent-resume:sub-1',
        {
          type: 'subagent-resume',
          subagentId: 'sub-1',
          toolCallId: 'tc-1',
          agentName: 'explorer',
          blocking: false,
          prompt: 'look around',
          model: 'local::qwen',
          capabilities: 'read-only',
          workspace: { projectRoot: '/tmp/wt', projectSlug: 'feature' },
          messages: snapshotMessages,
        },
        '2020-01-01T00:00:01.000Z',
      ),
      harnessLine(
        'sub-1-history',
        {
          type: 'subagent-event',
          subagentId: 'sub-1',
          event: {
            type: 'subagent-history',
            messages: historyMessages,
          },
        },
        '2020-01-01T00:00:02.000Z',
      ),
      harnessLine(
        'sub-1-history-tail',
        {
          type: 'subagent-event',
          subagentId: 'sub-1',
          event: {
            type: 'subagent-history',
            messages: tailMessages,
          },
        },
        '',
      ),
    ])

    const { createSession } = await import('@/composables/chat-store/helpers')
    const hydrateSessionFromDisk = (await import('@/composables/chat-store/hydrate'))
      .default
    const session = createSession('proj', 'chat-hydrate-history-untimestamped-tail')
    await hydrateSessionFromDisk(session)

    const item = session.timeline.value[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.messages).toEqual(historyMessages)
    expect(item.messages).not.toEqual(tailMessages)
    expect(item.messages).not.toEqual(snapshotMessages)
    expect(item.model).toBe('local::qwen')
    expect(item.capabilities).toBe('read-only')
    expect(item.workspace).toEqual({
      projectRoot: '/tmp/wt',
      projectSlug: 'feature',
    })
  })

  it('does not let a history line without createdAt replace resume snapshot messages', async () => {
    const historyMessages = [{ role: 'user' as const, content: 'stale history' }]
    const vixl = await import('@/services/vixl/vixl-tauri')
    vi.mocked(vixl.readChatMessages).mockResolvedValue([
      harnessLine('sub-1', {
        type: 'subagent-start',
        subagentId: 'sub-1',
        name: 'explorer',
        blocking: false,
        prompt: 'look around',
        model: 'local::qwen',
      }),
      harnessLine(
        'subagent-resume:sub-1',
        {
          type: 'subagent-resume',
          subagentId: 'sub-1',
          toolCallId: 'tc-1',
          agentName: 'explorer',
          blocking: false,
          prompt: 'look around',
          model: 'local::qwen',
          capabilities: 'write',
          workspace: { projectRoot: '/tmp/wt', projectSlug: 'feature' },
          messages: snapshotMessages,
        },
        '2020-01-01T00:00:02.000Z',
      ),
      harnessLine(
        'sub-1-history',
        {
          type: 'subagent-event',
          subagentId: 'sub-1',
          event: {
            type: 'subagent-history',
            messages: historyMessages,
          },
        },
        '',
      ),
    ])

    const { createSession } = await import('@/composables/chat-store/helpers')
    const hydrateSessionFromDisk = (await import('@/composables/chat-store/hydrate'))
      .default
    const session = createSession('proj', 'chat-hydrate-history-no-created-at')
    await hydrateSessionFromDisk(session)

    const item = session.timeline.value[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.messages).toEqual(snapshotMessages)
    expect(item.model).toBe('local::qwen')
    expect(item.capabilities).toBe('write')
    expect(item.workspace).toEqual({
      projectRoot: '/tmp/wt',
      projectSlug: 'feature',
    })
  })

  it('keeps an earlier history timestamp when a later history line has no createdAt', async () => {
    const earlyHistoryMessages = [
      { role: 'user' as const, content: 'early history' },
    ]
    const laterHistoryMessages = [
      { role: 'user' as const, content: 'later history without timestamp' },
    ]
    const vixl = await import('@/services/vixl/vixl-tauri')
    vi.mocked(vixl.readChatMessages).mockResolvedValue([
      harnessLine('sub-1', {
        type: 'subagent-start',
        subagentId: 'sub-1',
        name: 'explorer',
        blocking: false,
        prompt: 'look around',
        model: 'local::qwen',
      }),
      harnessLine(
        'sub-1-history-early',
        {
          type: 'subagent-event',
          subagentId: 'sub-1',
          event: {
            type: 'subagent-history',
            messages: earlyHistoryMessages,
          },
        },
        '2020-01-01T00:00:01.000Z',
      ),
      harnessLine(
        'sub-1-history-later',
        {
          type: 'subagent-event',
          subagentId: 'sub-1',
          event: {
            type: 'subagent-history',
            messages: laterHistoryMessages,
          },
        },
        '',
      ),
      harnessLine(
        'subagent-resume:sub-1',
        {
          type: 'subagent-resume',
          subagentId: 'sub-1',
          toolCallId: 'tc-1',
          agentName: 'explorer',
          blocking: false,
          prompt: 'look around',
          model: 'local::qwen',
          capabilities: 'read-only',
          workspace: { projectRoot: '/tmp/wt', projectSlug: 'feature' },
          messages: snapshotMessages,
        },
        '2020-01-01T00:00:03.000Z',
      ),
    ])

    const { createSession } = await import('@/composables/chat-store/helpers')
    const hydrateSessionFromDisk = (await import('@/composables/chat-store/hydrate'))
      .default
    const session = createSession('proj', 'chat-hydrate-history-keeps-timestamp')
    await hydrateSessionFromDisk(session)

    const item = session.timeline.value[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.messages).toEqual(snapshotMessages)
    expect(item.model).toBe('local::qwen')
    expect(item.capabilities).toBe('read-only')
    expect(item.workspace).toEqual({
      projectRoot: '/tmp/wt',
      projectSlug: 'feature',
    })
  })

  it('uses resume messages when the resume line createdAt is newer than history', async () => {
    const historyMessages = [{ role: 'user' as const, content: 'stale history' }]
    const vixl = await import('@/services/vixl/vixl-tauri')
    vi.mocked(vixl.readChatMessages).mockResolvedValue([
      harnessLine('sub-1', {
        type: 'subagent-start',
        subagentId: 'sub-1',
        name: 'explorer',
        blocking: false,
        prompt: 'look around',
        model: 'local::qwen',
      }),
      harnessLine(
        'subagent-resume:sub-1',
        {
          type: 'subagent-resume',
          subagentId: 'sub-1',
          toolCallId: 'tc-1',
          agentName: 'explorer',
          blocking: false,
          prompt: 'look around',
          model: 'local::qwen',
          capabilities: 'write',
          messages: snapshotMessages,
        },
        '2020-01-01T00:00:02.000Z',
      ),
      harnessLine(
        'sub-1-history',
        {
          type: 'subagent-event',
          subagentId: 'sub-1',
          event: {
            type: 'subagent-history',
            messages: historyMessages,
          },
        },
        '2020-01-01T00:00:01.000Z',
      ),
    ])

    const { createSession } = await import('@/composables/chat-store/helpers')
    const hydrateSessionFromDisk = (await import('@/composables/chat-store/hydrate'))
      .default
    const session = createSession('proj', 'chat-hydrate-resume-newer')
    await hydrateSessionFromDisk(session)

    const item = session.timeline.value[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.messages).toEqual(snapshotMessages)
    expect(item.capabilities).toBe('write')
  })
})

describe('hydrateSessionFromDisk compaction context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('omits pre-compact assistant messages from the active context slice', async () => {
    const vixl = await import('@/services/vixl/vixl-tauri')
    vi.mocked(vixl.readChatMessages).mockResolvedValue([
      {
        ...harnessLine('pre-compact', {
          type: 'tool-run',
          toolCallId: 'tc-pre',
          name: 'read_file',
          status: 'done',
          args: { path: 'a.ts' },
          result: { content: 'ok' },
        }),
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        ...harnessLine('compact-1', {
          type: 'compaction',
          summary: 'Prior work',
          focus: 'parent',
        }),
        createdAt: '2026-01-01T00:05:00.000Z',
      },
      {
        ...harnessLine('post-compact', {
          type: 'tool-run',
          toolCallId: 'tc-post',
          name: 'read_file',
          status: 'done',
          args: { path: 'b.ts' },
          result: { content: 'later' },
        }),
        createdAt: '2026-01-01T00:10:00.000Z',
      },
    ])

    const { createSession } = await import('@/composables/chat-store/helpers')
    const hydrateSessionFromDisk = (await import('@/composables/chat-store/hydrate'))
      .default
    const session = createSession('proj', 'chat-hydrate-compact-filter')
    await hydrateSessionFromDisk(session)

    const pre = session.messages.value.find((message) => message.id === 'tc-pre')
    expect(pre).toBeDefined()
    expect(pre?.metadata).toEqual({ createdAt: '2026-01-01T00:00:00.000Z' })
    const post = session.messages.value.find((message) => message.id === 'tc-post')
    expect(post).toBeDefined()
    expect(post?.metadata).toEqual({ createdAt: '2026-01-01T00:10:00.000Z' })

    const { default: filterMessagesForActiveContext } = await import(
      '@/services/context/filter-messages-for-active-context'
    )
    const { messages, checkpointText } = filterMessagesForActiveContext(
      session.messages.value,
      { summary: 'Prior work', includeFromCreatedAt: '2026-01-01T00:05:00.000Z' },
    )
    const ids = messages.map((message) => message.id)
    expect(ids).not.toContain('tc-pre')
    expect(ids).toContain('tc-post')
    expect(checkpointText).toContain('Prior work')
  })
})
