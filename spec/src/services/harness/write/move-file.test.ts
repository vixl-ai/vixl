import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import type { FileDiff } from '@/types/harness/file-diff'
import type { FileCheckpointCaptureResult } from '@/types/harness/file-checkpoint'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import type { AgentTurn } from '@/types/chat/agent-turn'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'
import { resolveBaselinesForRevert } from '@/services/harness/restore-file-checkpoints'

const notifyWorkspaceFsMutation = vi.hoisted(() =>
  vi.fn<(projectRoot: string, paths: string[]) => void>(),
)
const gateToolPermission = vi.hoisted(() => vi.fn<() => Promise<boolean>>())
const captureBaselinesBeforeMutate = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
)
const fsMove = vi.hoisted(() =>
  vi.fn<(args: { projectRoot: string; from: string; to: string }) => Promise<void>>(
    async () => undefined,
  ),
)
const fsStat = vi.hoisted(() =>
  vi.fn<
    (
      projectRoot: string,
      path: string,
      projectRoots?: Array<{ slug: string; path: string }>,
    ) => Promise<{ path: string; exists: boolean; kind: string; size: number }>
  >(),
)
const fileCheckpointCapture = vi.hoisted(() =>
  vi.fn<
    (args: {
      projectSlug: string
      chatId: string
      userMessageId: string
      projectRoot: string
      path: string
      key?: string
      toolCallId?: string
    }) => Promise<FileCheckpointCaptureResult>
  >(),
)

vi.mock('@/services/harness/shared/notify-fs-mutation', () => ({
  notifyWorkspaceFsMutation,
}))

vi.mock('@/services/harness/permission/gate', () => ({
  gateToolPermission,
}))

vi.mock('@/services/harness/capture-baselines-before-mutate', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/services/harness/capture-baselines-before-mutate')
  >()
  return {
    ...actual,
    default: captureBaselinesBeforeMutate,
  }
})

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    fsMove,
    fsStat,
    fileCheckpointCapture,
  }),
)

import moveFile from '@/services/harness/write/move-file'

const renameDiff = (fromPath: string, toPath: string): FileDiff => ({
  path: fromPath,
  operation: 'rename',
  newContent: toPath,
  hunks: [
    {
      oldStart: 1,
      newStart: 1,
      lines: [
        { kind: 'remove', content: fromPath },
        { kind: 'add', content: toPath },
      ],
    },
  ],
})

const capturedFile = (path: string): FileCheckpointCaptureResult['captured'][number] => ({
  path,
  pathHash: `hash-${path}`,
  existed: true,
  capturedAt: 'now',
  toolCallId: 'call-1',
})

const baseCtx = (): HarnessToolContext => ({
  projectRoot: '/tmp/project',
  projectSlug: 'project',
  chatId: 'chat-1',
  mode: 'agent',
  userMessageId: 'user-1',
  settings: { version: 1 } as VixlSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set(),
  sessionDenies: new Set(),
  sandboxEnabled: true,
  supportsVision: false,
  onPendingApproval: () => {},
})

const rpg: HarnessWorkspaceMember = {
  slug: 'rpg-test',
  name: 'RPG',
  rootPath: '/tmp/rpg-test',
}
const other: HarnessWorkspaceMember = {
  slug: 'other',
  name: 'Other',
  rootPath: '/tmp/other',
}

const groupCtx = (): HarnessToolContext => ({
  ...baseCtx(),
  projectRoot: '/tmp/rpg-test',
  projectSlug: 'stack',
  members: [rpg, other],
})

const execute = async (
  tool: { execute?: unknown },
  input: Record<string, unknown>,
): Promise<unknown> => {
  const runner = tool.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'call-1' })
}

const turnFromDiffs = (id: string, diffs: FileDiff[]): AgentTurn => ({
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
          name: 'move_file',
          status: 'done',
          diffs,
        },
      ],
    },
  ],
})

describe('move_file directory checkpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gateToolPermission.mockResolvedValue(true)
    fsStat.mockResolvedValue({
      path: 'src/a.ts',
      exists: true,
      kind: 'file',
      size: 1,
    })
    fileCheckpointCapture.mockResolvedValue({
      captured: [capturedFile('src/a.ts')],
      skippedOversize: [],
    })
  })

  it('keeps a single-file move as one rename diff and captures from and to', async () => {
    const result = await execute(moveFile(baseCtx()), {
      from: 'src/a.ts',
      to: 'lib/b.ts',
    })

    expect(fsStat).toHaveBeenCalledWith('/tmp/project', 'src/a.ts', undefined)
    expect(fileCheckpointCapture).not.toHaveBeenCalled()
    expect(captureBaselinesBeforeMutate).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: '/tmp/project' }),
      ['src/a.ts', 'lib/b.ts'],
      'call-1',
    )
    expect(gateToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        diff: [renameDiff('src/a.ts', 'lib/b.ts')],
      }),
    )
    expect(fsMove).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'src/a.ts', to: 'lib/b.ts' }),
    )
    expect(result).toEqual({
      ok: true,
      from: 'src/a.ts',
      to: 'lib/b.ts',
      diffs: [renameDiff('src/a.ts', 'lib/b.ts')],
    })
  })

  it('captures the from-directory and each to-file, then moves the directory once', async () => {
    fsStat.mockResolvedValue({
      path: 'eval-dir',
      exists: true,
      kind: 'directory',
      size: 0,
    })
    fileCheckpointCapture.mockResolvedValue({
      captured: [capturedFile('eval-dir/a.md'), capturedFile('eval-dir/nested/b.md')],
      skippedOversize: [],
    })

    const result = await execute(moveFile(baseCtx()), {
      from: 'eval-dir',
      to: 'moved-dir',
    })

    expect(fileCheckpointCapture).toHaveBeenCalledWith({
      projectSlug: 'project',
      chatId: 'chat-1',
      userMessageId: 'user-1',
      projectRoot: '/tmp/project',
      path: 'eval-dir',
      toolCallId: 'call-1',
    })
    expect(captureBaselinesBeforeMutate).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: '/tmp/project' }),
      ['moved-dir/a.md', 'moved-dir/nested/b.md'],
      'call-1',
    )
    expect(gateToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        diff: [
          renameDiff('eval-dir/a.md', 'moved-dir/a.md'),
          renameDiff('eval-dir/nested/b.md', 'moved-dir/nested/b.md'),
        ],
      }),
    )
    expect(fsMove).toHaveBeenCalledTimes(1)
    expect(fsMove).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'eval-dir', to: 'moved-dir' }),
    )
    expect(result).toEqual({
      ok: true,
      from: 'eval-dir',
      to: 'moved-dir',
      diffs: [
        renameDiff('eval-dir/a.md', 'moved-dir/a.md'),
        renameDiff('eval-dir/nested/b.md', 'moved-dir/nested/b.md'),
      ],
    })
  })

  it('feeds per-file rename diffs into revert aggregation for old and new paths', async () => {
    fsStat.mockResolvedValue({
      path: 'eval-dir',
      exists: true,
      kind: 'directory',
      size: 0,
    })
    fileCheckpointCapture.mockResolvedValue({
      captured: [capturedFile('eval-dir/a.md'), capturedFile('eval-dir/nested/b.md')],
      skippedOversize: [],
    })

    const result = (await execute(moveFile(baseCtx()), {
      from: 'eval-dir',
      to: 'moved-dir',
    })) as { diffs: FileDiff[] }

    const timeline: ChatTimelineItem[] = [
      {
        type: 'user',
        message: {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', text: 'move the dir' }],
        },
      },
      {
        type: 'agent-turn',
        turn: turnFromDiffs('t1', result.diffs),
      },
    ]

    expect(resolveBaselinesForRevert(timeline, 'user-1')).toEqual([
      { path: 'eval-dir/a.md', userMessageId: 'user-1' },
      { path: 'eval-dir/nested/b.md', userMessageId: 'user-1' },
      { path: 'moved-dir/a.md', userMessageId: 'user-1' },
      { path: 'moved-dir/nested/b.md', userMessageId: 'user-1' },
    ])
  })

  it('refuses a directory move when capture skips oversize files', async () => {
    fsStat.mockResolvedValue({
      path: 'eval-dir',
      exists: true,
      kind: 'directory',
      size: 0,
    })
    fileCheckpointCapture.mockResolvedValue({
      captured: [capturedFile('eval-dir/ok.md')],
      skippedOversize: ['eval-dir/huge.bin', 'eval-dir/also-huge.bin'],
    })

    const result = await execute(moveFile(baseCtx()), {
      from: 'eval-dir',
      to: 'moved-dir',
    })

    expect(result).toEqual({
      error:
        'Refusing to move directory: 2 file(s) exceed the checkpoint size limit and would have no undo baseline: eval-dir/huge.bin, eval-dir/also-huge.bin',
    })
    expect(gateToolPermission).not.toHaveBeenCalled()
    expect(captureBaselinesBeforeMutate).not.toHaveBeenCalled()
    expect(fsMove).not.toHaveBeenCalled()
    expect(notifyWorkspaceFsMutation).not.toHaveBeenCalled()
  })

  it('maps member-qualified captured keys onto the destination member paths', async () => {
    fsStat.mockResolvedValue({
      path: 'rpg-test/eval-dir',
      exists: true,
      kind: 'directory',
      size: 0,
    })
    fileCheckpointCapture.mockResolvedValue({
      captured: [
        capturedFile('rpg-test/eval-dir/a.md'),
        capturedFile('rpg-test/eval-dir/nested/b.md'),
      ],
      skippedOversize: [],
    })

    const result = await execute(moveFile(groupCtx()), {
      from: 'rpg-test/eval-dir',
      to: 'rpg-test/moved-dir',
    })

    expect(fileCheckpointCapture).toHaveBeenCalledWith({
      projectSlug: 'stack',
      chatId: 'chat-1',
      userMessageId: 'user-1',
      projectRoot: '/tmp/rpg-test',
      path: 'eval-dir',
      key: 'rpg-test/eval-dir',
      toolCallId: 'call-1',
    })
    expect(captureBaselinesBeforeMutate).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: '/tmp/rpg-test' }),
      ['rpg-test/moved-dir/a.md', 'rpg-test/moved-dir/nested/b.md'],
      'call-1',
    )
    expect(result).toEqual({
      ok: true,
      from: 'rpg-test/eval-dir',
      to: 'rpg-test/moved-dir',
      diffs: [
        renameDiff('rpg-test/eval-dir/a.md', 'rpg-test/moved-dir/a.md'),
        renameDiff('rpg-test/eval-dir/nested/b.md', 'rpg-test/moved-dir/nested/b.md'),
      ],
    })
  })

  it('still rejects a cross-member move before stating the source', async () => {
    const result = await execute(moveFile(groupCtx()), {
      from: 'rpg-test/eval-dir',
      to: 'other/moved-dir',
    })

    expect(result).toEqual({
      error: 'Move paths must belong to a single project member',
    })
    expect(fsStat).not.toHaveBeenCalled()
    expect(fileCheckpointCapture).not.toHaveBeenCalled()
    expect(gateToolPermission).not.toHaveBeenCalled()
    expect(fsMove).not.toHaveBeenCalled()
  })
})
