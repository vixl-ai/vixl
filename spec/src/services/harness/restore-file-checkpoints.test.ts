import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import type { FileCheckpointRestoreResult } from '@/types/harness/file-checkpoint'

const fileCheckpointRestore = vi.hoisted(() =>
  vi.fn<
    (args: {
      projectSlug: string
      chatId: string
      projectRoot: string
      targets: Array<{ path: string; userMessageId: string; key?: string }>
    }) => Promise<FileCheckpointRestoreResult>
  >(),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    fileCheckpointRestore: (
      args: {
        projectSlug: string
        chatId: string
        projectRoot: string
        targets: Array<{ path: string; userMessageId: string; key?: string }>
      },
    ) => fileCheckpointRestore(args),
  }),
)

import {
  aggregateSubagentFileDiffs,
  aggregateTurnFileDiffs,
  collectMutationsAfterUserMessage,
  groupCheckpointRestoreTargets,
  resolveBaselinesForRevert,
  restoreFileCheckpoints,
  summarizeMutationCounts,
} from '@/services/harness/restore-file-checkpoints'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type {
  ChatTimelineItem,
  SubagentTimelineItem,
} from '@/types/chat/chat-timeline-item'
import type { AggregatedTurnFileChange } from '@/types/harness/file-checkpoint'
import type { FileDiff } from '@/types/harness/file-diff'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'

const makeTurn = (id: string, diffs: AgentTurn['steps'][0]['tools'][0]['diffs']): AgentTurn => ({
  id,
  text: '',
  steps: [
    {
      id: `${id}-step`,
      text: '',
      reasoning: '',
      tools: [
        {
          toolCallId: `${id}-tool`,
          name: 'write_file',
          status: 'done',
          diffs,
        },
      ],
    },
  ],
})

const pathDiff = (path: string, operation: FileDiff['operation']): FileDiff => ({
  path,
  operation,
  hunks: [],
})

const makeSubagent = (
  id: string,
  diffs: FileDiff[],
): SubagentTimelineItem => ({
  type: 'subagent',
  subagentId: id,
  name: 'explore',
  blocking: false,
  status: 'done',
  tools: [
    {
      toolCallId: `${id}-tool`,
      name: 'write_file',
      status: 'done',
      diffs,
    },
  ],
  compactions: [],
})

const userItem = (id: string, text: string): ChatTimelineItem => ({
  type: 'user',
  message: {
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
  },
})

describe('restore-file-checkpoints aggregation', () => {
  it('aggregates turn diffs by path', () => {
    const turn = makeTurn('t1', [
      {
        path: 'a.ts',
        operation: 'update',
        hunks: [
          {
            oldStart: 1,
            newStart: 1,
            lines: [
              { kind: 'remove', content: 'old' },
              { kind: 'add', content: 'new' },
            ],
          },
        ],
      },
      {
        path: 'b.ts',
        operation: 'create',
        hunks: [
          {
            oldStart: 1,
            newStart: 1,
            lines: [{ kind: 'add', content: 'x' }],
          },
        ],
      },
    ])

    const changes = aggregateTurnFileDiffs(turn)
    expect(changes).toHaveLength(2)
    expect(changes.map((item) => item.path)).toEqual(['a.ts', 'b.ts'])
    expect(summarizeMutationCounts(changes)).toMatchObject({
      files: 2,
      created: 1,
      updated: 1,
    })
  })

  it('collects mutations after a user message and resolves baselines', () => {
    const timeline: ChatTimelineItem[] = [
      {
        type: 'user',
        message: {
          id: 'u1',
          role: 'user',
          parts: [{ type: 'text', text: 'one' }],
        },
      },
      {
        type: 'agent-turn',
        turn: makeTurn('t1', [
          {
            path: 'a.ts',
            operation: 'update',
            hunks: [],
          },
        ]),
      },
      {
        type: 'user',
        message: {
          id: 'u2',
          role: 'user',
          parts: [{ type: 'text', text: 'two' }],
        },
      },
      {
        type: 'agent-turn',
        turn: makeTurn('t2', [
          {
            path: 'a.ts',
            operation: 'update',
            hunks: [],
          },
          {
            path: 'c.ts',
            operation: 'create',
            hunks: [],
          },
        ]),
      },
    ]

    const afterU1 = collectMutationsAfterUserMessage(timeline, 'u1')
    expect(afterU1.map((item) => item.path).sort()).toEqual(['a.ts', 'c.ts'])

    const targets = resolveBaselinesForRevert(timeline, 'u1')
    expect(targets).toEqual([
      { path: 'a.ts', userMessageId: 'u1' },
      { path: 'c.ts', userMessageId: 'u2' },
    ])
  })

  it('folds subagent diffs after the boundary user message', () => {
    const timeline: ChatTimelineItem[] = [
      userItem('u1', 'one'),
      {
        type: 'agent-turn',
        turn: makeTurn('t1', [pathDiff('a.ts', 'update')]),
      },
      makeSubagent('sub-1', [pathDiff('b.ts', 'create')]),
      userItem('u2', 'two'),
      {
        type: 'agent-turn',
        turn: makeTurn('t2', [pathDiff('c.ts', 'create')]),
      },
    ]

    const afterU1 = collectMutationsAfterUserMessage(timeline, 'u1')
    expect(afterU1.map((item) => item.path)).toEqual(['a.ts', 'b.ts', 'c.ts'])

    const afterU2 = collectMutationsAfterUserMessage(timeline, 'u2')
    expect(afterU2.map((item) => item.path)).toEqual(['c.ts'])
  })

  it('includes a late subagent after the last user message even if spawned earlier', () => {
    const timeline: ChatTimelineItem[] = [
      userItem('u1', 'one'),
      {
        type: 'agent-turn',
        turn: makeTurn('t1', [pathDiff('old.ts', 'update')]),
      },
      userItem('u2', 'two'),
      {
        type: 'agent-turn',
        turn: makeTurn('t2', [pathDiff('last.ts', 'update')]),
      },
      makeSubagent('sub-1', [pathDiff('late-sub.ts', 'create')]),
    ]

    const preview = collectMutationsAfterUserMessage(timeline, 'u2')
    const targets = resolveBaselinesForRevert(timeline, 'u2')

    expect(preview.map((item) => item.path)).toEqual(['last.ts', 'late-sub.ts'])
    expect(targets.map((target) => target.path)).toEqual(['last.ts', 'late-sub.ts'])
  })

  it('attributes a subagent-only path to the user message in effect', () => {
    const timeline: ChatTimelineItem[] = [
      userItem('u1', 'one'),
      {
        type: 'agent-turn',
        turn: makeTurn('t1', [pathDiff('a.ts', 'update')]),
      },
      userItem('u2', 'two'),
      makeSubagent('sub-1', [pathDiff('d.ts', 'create')]),
    ]

    const targets = resolveBaselinesForRevert(timeline, 'u1')
    expect(targets).toEqual([
      { path: 'a.ts', userMessageId: 'u1' },
      { path: 'd.ts', userMessageId: 'u2' },
    ])
  })

  it('aggregates subagent tools and folds into an existing list', () => {
    const existing: AggregatedTurnFileChange[] = [
      { path: 'a.ts', operation: 'create', additions: 1, deletions: 0 },
    ]
    const subagent = makeSubagent('sub-1', [
      {
        path: 'a.ts',
        operation: 'update',
        hunks: [
          {
            oldStart: 1,
            newStart: 1,
            lines: [{ kind: 'add', content: 'x' }],
          },
        ],
      },
      pathDiff('b.ts', 'create'),
    ])

    const changes = aggregateSubagentFileDiffs(subagent, existing)
    expect(changes).toEqual([
      { path: 'a.ts', operation: 'update', additions: 2, deletions: 0 },
      { path: 'b.ts', operation: 'create', additions: 0, deletions: 0 },
    ])
  })
})

const api: HarnessWorkspaceMember = {
  slug: 'api',
  name: 'API',
  rootPath: '/tmp/api',
}
const web: HarnessWorkspaceMember = {
  slug: 'web',
  name: 'Web',
  rootPath: '/tmp/web',
}

describe('groupCheckpointRestoreTargets', () => {
  it('keeps a single-root restore on the primary projectRoot', () => {
    const targets = [{ path: 'src/a.ts', userMessageId: 'u1' }]
    expect(groupCheckpointRestoreTargets('/tmp/api', targets)).toEqual([
      {
        projectRoot: '/tmp/api',
        targets,
        originalPaths: ['src/a.ts'],
      },
    ])
  })

  it('splits slug-prefixed paths onto member roots with member-relative paths', () => {
    const grouped = groupCheckpointRestoreTargets(
      '/tmp/api',
      [
        { path: 'web/src/a.ts', userMessageId: 'u1' },
        { path: 'api/src/b.ts', userMessageId: 'u2' },
        { path: 'web/lib/c.ts', userMessageId: 'u1' },
      ],
      [api, web],
    )

    expect(grouped).toEqual([
      {
        projectRoot: '/tmp/web',
        targets: [
          { path: 'src/a.ts', userMessageId: 'u1', key: 'web/src/a.ts' },
          { path: 'lib/c.ts', userMessageId: 'u1', key: 'web/lib/c.ts' },
        ],
        originalPaths: ['web/src/a.ts', 'web/lib/c.ts'],
      },
      {
        projectRoot: '/tmp/api',
        targets: [{ path: 'src/b.ts', userMessageId: 'u2', key: 'api/src/b.ts' }],
        originalPaths: ['api/src/b.ts'],
      },
    ])
  })

  it('keeps colliding relative paths on distinct keys per member', () => {
    const grouped = groupCheckpointRestoreTargets(
      '/tmp/api',
      [
        { path: 'web/src/a.ts', userMessageId: 'u1' },
        { path: 'api/src/a.ts', userMessageId: 'u1' },
      ],
      [api, web],
    )

    expect(grouped).toEqual([
      {
        projectRoot: '/tmp/web',
        targets: [{ path: 'src/a.ts', userMessageId: 'u1', key: 'web/src/a.ts' }],
        originalPaths: ['web/src/a.ts'],
      },
      {
        projectRoot: '/tmp/api',
        targets: [{ path: 'src/a.ts', userMessageId: 'u1', key: 'api/src/a.ts' }],
        originalPaths: ['api/src/a.ts'],
      },
    ])
  })

  it('falls back to the primary root for an unprefixed path', () => {
    const grouped = groupCheckpointRestoreTargets(
      '/tmp/api',
      [{ path: 'src/plain.ts', userMessageId: 'u1' }],
      [api, web],
    )

    expect(grouped).toEqual([
      {
        projectRoot: '/tmp/api',
        targets: [{ path: 'src/plain.ts', userMessageId: 'u1' }],
        originalPaths: ['src/plain.ts'],
      },
    ])
  })
})

describe('restoreFileCheckpoints group restore', () => {
  beforeEach(() => {
    fileCheckpointRestore.mockReset()
    fileCheckpointRestore.mockResolvedValue({
      restored: [],
      deleted: [],
      skipped: [],
      errors: [],
    })
  })

  it('restores a single-root chat with the original paths', async () => {
    fileCheckpointRestore.mockResolvedValue({
      restored: ['src/a.ts'],
      deleted: [],
      skipped: [],
      errors: [],
    })

    const result = await restoreFileCheckpoints({
      projectSlug: 'proj',
      chatId: 'chat-1',
      projectRoot: '/tmp/proj',
      targets: [{ path: 'src/a.ts', userMessageId: 'u1' }],
    })

    expect(fileCheckpointRestore).toHaveBeenCalledTimes(1)
    expect(fileCheckpointRestore).toHaveBeenCalledWith({
      projectSlug: 'proj',
      chatId: 'chat-1',
      projectRoot: '/tmp/proj',
      targets: [{ path: 'src/a.ts', userMessageId: 'u1' }],
    })
    expect(result).toEqual({
      restored: ['src/a.ts'],
      deleted: [],
      skipped: [],
      errors: [],
    })
  })

  it('restores each member root with member-relative paths', async () => {
    fileCheckpointRestore
      .mockResolvedValueOnce({
        restored: ['src/a.ts'],
        deleted: [],
        skipped: [],
        errors: [],
      })
      .mockResolvedValueOnce({
        restored: [],
        deleted: ['src/b.ts'],
        skipped: [],
        errors: [],
      })

    const result = await restoreFileCheckpoints({
      projectSlug: 'stack',
      chatId: 'chat-1',
      projectRoot: '/tmp/api',
      members: [api, web],
      targets: [
        { path: 'web/src/a.ts', userMessageId: 'u1' },
        { path: 'api/src/b.ts', userMessageId: 'u1' },
      ],
    })

    expect(fileCheckpointRestore).toHaveBeenCalledTimes(2)
    expect(fileCheckpointRestore).toHaveBeenNthCalledWith(1, {
      projectSlug: 'stack',
      chatId: 'chat-1',
      projectRoot: '/tmp/web',
      targets: [{ path: 'src/a.ts', userMessageId: 'u1', key: 'web/src/a.ts' }],
    })
    expect(fileCheckpointRestore).toHaveBeenNthCalledWith(2, {
      projectSlug: 'stack',
      chatId: 'chat-1',
      projectRoot: '/tmp/api',
      targets: [{ path: 'src/b.ts', userMessageId: 'u1', key: 'api/src/b.ts' }],
    })
    expect(result).toEqual({
      restored: ['web/src/a.ts'],
      deleted: ['api/src/b.ts'],
      skipped: [],
      errors: [],
    })
  })

  it('errors slug-prefixed paths for a member whose project is gone', async () => {
    const missingWeb: HarnessWorkspaceMember = {
      slug: 'web',
      name: 'web',
      rootPath: '',
    }
    fileCheckpointRestore.mockResolvedValue({
      restored: ['src/b.ts'],
      deleted: [],
      skipped: [],
      errors: [],
    })

    const result = await restoreFileCheckpoints({
      projectSlug: 'stack',
      chatId: 'chat-1',
      projectRoot: '/tmp/api',
      members: [api, missingWeb],
      targets: [
        { path: 'web/src/a.ts', userMessageId: 'u1' },
        { path: 'api/src/b.ts', userMessageId: 'u1' },
      ],
    })

    expect(fileCheckpointRestore).toHaveBeenCalledTimes(1)
    expect(fileCheckpointRestore).toHaveBeenCalledWith({
      projectSlug: 'stack',
      chatId: 'chat-1',
      projectRoot: '/tmp/api',
      targets: [{ path: 'src/b.ts', userMessageId: 'u1', key: 'api/src/b.ts' }],
    })
    expect(result).toEqual({
      restored: ['api/src/b.ts'],
      deleted: [],
      skipped: [],
      errors: [{ path: 'web/src/a.ts', error: 'Project is no longer available' }],
    })
  })
})
