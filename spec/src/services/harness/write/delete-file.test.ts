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
const fsDelete = vi.hoisted(() =>
  vi.fn<(args: { projectRoot: string; path: string; recursive?: boolean }) => Promise<void>>(
    async () => undefined,
  ),
)
const fsStagePreviewDelete = vi.hoisted(() =>
  vi.fn<(args: { projectRoot: string; path: string }) => Promise<FileDiff[]>>(async () => []),
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
    fsDelete,
    fsStagePreviewDelete,
    fsStat,
    fileCheckpointCapture,
  }),
)

import deleteFile from '@/services/harness/write/delete-file'

const emptyDiff = (path: string, operation: FileDiff['operation']): FileDiff => ({
  path,
  operation,
  hunks: [],
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
          name: 'delete_file',
          status: 'done',
          diffs,
        },
      ],
    },
  ],
})

describe('delete_file recursive directory checkpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gateToolPermission.mockResolvedValue(true)
    fsStagePreviewDelete.mockResolvedValue([emptyDiff('src/a.ts', 'delete')])
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

  it('keeps current capture for recursive true on a plain file', async () => {
    const result = await execute(deleteFile(baseCtx()), {
      path: 'src/a.ts',
      recursive: true,
    })

    expect(fsStat).toHaveBeenCalledWith('/tmp/project', 'src/a.ts', undefined)
    expect(fsStagePreviewDelete).toHaveBeenCalled()
    expect(captureBaselinesBeforeMutate).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: '/tmp/project' }),
      ['src/a.ts'],
      'call-1',
    )
    expect(fileCheckpointCapture).not.toHaveBeenCalled()
    expect(fsDelete).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'src/a.ts', recursive: true }),
    )
    expect(result).toEqual(expect.objectContaining({ ok: true, path: 'src/a.ts' }))
  })

  it('captures the directory and returns per-file diffs when recursive is true', async () => {
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

    const result = await execute(deleteFile(baseCtx()), {
      path: 'eval-dir',
      recursive: true,
    })

    expect(fileCheckpointCapture).toHaveBeenCalledWith({
      projectSlug: 'project',
      chatId: 'chat-1',
      userMessageId: 'user-1',
      projectRoot: '/tmp/project',
      path: 'eval-dir',
      toolCallId: 'call-1',
    })
    expect(captureBaselinesBeforeMutate).not.toHaveBeenCalled()
    expect(fsStagePreviewDelete).not.toHaveBeenCalled()
    expect(gateToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        diff: [
          emptyDiff('eval-dir/a.md', 'delete'),
          emptyDiff('eval-dir/nested/b.md', 'delete'),
        ],
      }),
    )
    expect(fsDelete).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'eval-dir', recursive: true }),
    )
    expect(result).toEqual({
      ok: true,
      path: 'eval-dir',
      diffs: [
        emptyDiff('eval-dir/a.md', 'delete'),
        emptyDiff('eval-dir/nested/b.md', 'delete'),
      ],
    })
  })

  it('refuses recursive delete when capture skips oversize files', async () => {
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

    const result = await execute(deleteFile(baseCtx()), {
      path: 'eval-dir',
      recursive: true,
    })

    expect(result).toEqual({
      error:
        'Refusing to delete directory: 2 file(s) exceed the checkpoint size limit and would have no undo baseline: eval-dir/huge.bin, eval-dir/also-huge.bin',
    })
    expect(gateToolPermission).not.toHaveBeenCalled()
    expect(fsDelete).not.toHaveBeenCalled()
    expect(notifyWorkspaceFsMutation).not.toHaveBeenCalled()
  })

  it('passes member-prefixed directory key to capture and uses captured keys as diffs', async () => {
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

    const result = await execute(deleteFile(groupCtx()), {
      path: 'rpg-test/eval-dir',
      recursive: true,
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
    expect(result).toEqual({
      ok: true,
      path: 'rpg-test/eval-dir',
      diffs: [
        emptyDiff('rpg-test/eval-dir/a.md', 'delete'),
        emptyDiff('rpg-test/eval-dir/nested/b.md', 'delete'),
      ],
    })
  })

  it('does not capture a directory when recursive is absent', async () => {
    fsStagePreviewDelete.mockRejectedValue(new Error('is a directory'))

    const result = await execute(deleteFile(baseCtx()), { path: 'eval-dir' })

    expect(fsStat).not.toHaveBeenCalled()
    expect(fileCheckpointCapture).not.toHaveBeenCalled()
    expect(captureBaselinesBeforeMutate).toHaveBeenCalledWith(
      expect.anything(),
      ['eval-dir'],
      'call-1',
    )
    expect(fsDelete).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'eval-dir', recursive: undefined }),
    )
    expect(result).toEqual({
      ok: true,
      path: 'eval-dir',
      diffs: [emptyDiff('eval-dir', 'delete')],
    })
  })

  it('feeds per-file diffs into revert aggregation', async () => {
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

    const result = (await execute(deleteFile(baseCtx()), {
      path: 'eval-dir',
      recursive: true,
    })) as { diffs: FileDiff[] }

    const timeline: ChatTimelineItem[] = [
      {
        type: 'user',
        message: {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', text: 'delete the dir' }],
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
    ])
  })
})
