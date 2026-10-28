import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import type { FileDiff } from '@/types/harness/file-diff'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const notifyWorkspaceFsMutation = vi.hoisted(() =>
  vi.fn<(projectRoot: string, paths: string[]) => void>(),
)
const gateToolPermission = vi.hoisted(() => vi.fn<() => Promise<boolean>>())
const captureBaselinesBeforeMutate = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
)
const fsWriteFile = vi.hoisted(() =>
  vi.fn<(args: { projectRoot: string; path: string; content: string }) => Promise<unknown>>(
    async () => undefined,
  ),
)
const fsDelete = vi.hoisted(() =>
  vi.fn<(args: { projectRoot: string; path: string; recursive?: boolean }) => Promise<void>>(
    async () => undefined,
  ),
)
const fsMove = vi.hoisted(() =>
  vi.fn<(args: { projectRoot: string; from: string; to: string }) => Promise<void>>(
    async () => undefined,
  ),
)
const fsApplyPatch = vi.hoisted(() =>
  vi.fn<(args: { projectRoot: string; patch: string }) => Promise<unknown>>(async () => []),
)
const fsStagePreviewWrite = vi.hoisted(() =>
  vi.fn<(args: { projectRoot: string; path: string; content: string }) => Promise<FileDiff[]>>(
    async () => [],
  ),
)
const fsStagePreviewDelete = vi.hoisted(() =>
  vi.fn<(args: { projectRoot: string; path: string }) => Promise<FileDiff[]>>(async () => []),
)
const fsStagePreviewApplyPatch = vi.hoisted(() =>
  vi.fn<(args: { projectRoot: string; patch: string }) => Promise<FileDiff[]>>(async () => []),
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
    fsWriteFile,
    fsDelete,
    fsMove,
    fsApplyPatch,
    fsStagePreviewWrite,
    fsStagePreviewDelete,
    fsStagePreviewApplyPatch,
  }),
)

import writeFile from '@/services/harness/write/file'
import deleteFile from '@/services/harness/write/delete-file'
import moveFile from '@/services/harness/write/move-file'
import applyPatch from '@/services/harness/edit/apply-patch'

const emptyDiff = (path: string, operation: FileDiff['operation']): FileDiff => ({
  path,
  operation,
  hunks: [],
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

describe('harness tools notify workspace fs mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gateToolPermission.mockResolvedValue(true)
    fsStagePreviewWrite.mockResolvedValue([emptyDiff('src/a.ts', 'create')])
    fsStagePreviewDelete.mockResolvedValue([emptyDiff('src/a.ts', 'delete')])
    fsStagePreviewApplyPatch.mockResolvedValue([
      emptyDiff('src/added.ts', 'create'),
      emptyDiff('src/gone.ts', 'delete'),
      emptyDiff('src/moved.ts', 'rename'),
      emptyDiff('src/edited.ts', 'update'),
    ])
  })

  it('write_file notifies after a successful write', async () => {
    const result = await execute(writeFile(baseCtx()), {
      path: 'src/a.ts',
      content: 'next',
    })

    expect(result).toEqual(expect.objectContaining({ ok: true, path: 'src/a.ts' }))
    expect(notifyWorkspaceFsMutation).toHaveBeenCalledWith('/tmp/project', ['src/a.ts'])
  })

  it('write_file does not notify when the permission gate rejects', async () => {
    gateToolPermission.mockResolvedValue(false)
    const result = await execute(writeFile(baseCtx()), {
      path: 'src/a.ts',
      content: 'next',
    })

    expect(result).toEqual({ rejected: true, error: 'Write not approved' })
    expect(fsWriteFile).not.toHaveBeenCalled()
    expect(notifyWorkspaceFsMutation).not.toHaveBeenCalled()
  })

  it('delete_file notifies after a successful delete', async () => {
    const result = await execute(deleteFile(baseCtx()), { path: 'src/a.ts' })

    expect(result).toEqual(expect.objectContaining({ ok: true, path: 'src/a.ts' }))
    expect(notifyWorkspaceFsMutation).toHaveBeenCalledWith('/tmp/project', ['src/a.ts'])
  })

  it('delete_file does not notify when the permission gate rejects', async () => {
    gateToolPermission.mockResolvedValue(false)
    const result = await execute(deleteFile(baseCtx()), { path: 'src/a.ts' })

    expect(result).toEqual({ rejected: true, error: 'Delete not approved' })
    expect(fsDelete).not.toHaveBeenCalled()
    expect(notifyWorkspaceFsMutation).not.toHaveBeenCalled()
  })

  it('move_file notifies after a successful move with from and to', async () => {
    const result = await execute(moveFile(baseCtx()), {
      from: 'src/a.ts',
      to: 'lib/b.ts',
    })

    expect(result).toEqual(expect.objectContaining({ ok: true, from: 'src/a.ts', to: 'lib/b.ts' }))
    expect(notifyWorkspaceFsMutation).toHaveBeenCalledWith('/tmp/project', ['src/a.ts', 'lib/b.ts'])
  })

  it('move_file does not notify when the permission gate rejects', async () => {
    gateToolPermission.mockResolvedValue(false)
    const result = await execute(moveFile(baseCtx()), {
      from: 'src/a.ts',
      to: 'lib/b.ts',
    })

    expect(result).toEqual({ rejected: true, error: 'Move not approved' })
    expect(fsMove).not.toHaveBeenCalled()
    expect(notifyWorkspaceFsMutation).not.toHaveBeenCalled()
  })

  it('apply_patch notifies with every path from the staged diffs', async () => {
    const patch = '*** Update File: src/edited.ts\n@@\n-old\n+new'
    const result = await execute(applyPatch(baseCtx()), { patch })

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        paths: ['src/added.ts', 'src/gone.ts', 'src/moved.ts', 'src/edited.ts'],
      }),
    )
    expect(gateToolPermission).toHaveBeenCalledTimes(2)
    expect(gateToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fs.delete',
        capability: 'fs.delete:src/gone.ts',
        name: 'apply_patch',
        kind: 'fs',
        title: 'Delete src/gone.ts',
        paths: ['src/gone.ts'],
        diff: [emptyDiff('src/gone.ts', 'delete')],
      }),
    )
    expect(gateToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fs.write',
        capability: 'fs.write:*',
        name: 'apply_patch',
        kind: 'fs',
        paths: ['src/added.ts', 'src/moved.ts', 'src/edited.ts'],
        diff: [
          emptyDiff('src/added.ts', 'create'),
          emptyDiff('src/moved.ts', 'rename'),
          emptyDiff('src/edited.ts', 'update'),
        ],
      }),
    )
    expect(notifyWorkspaceFsMutation).toHaveBeenCalledWith('/tmp/project', [
      'src/added.ts',
      'src/gone.ts',
      'src/moved.ts',
      'src/edited.ts',
    ])
  })

  it('apply_patch mixed preview skips apply when the delete gate rejects', async () => {
    gateToolPermission.mockResolvedValueOnce(false)
    const result = await execute(applyPatch(baseCtx()), {
      patch: '*** Update File: src/edited.ts\n@@\n-old\n+new',
    })

    expect(gateToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fs.delete',
        capability: 'fs.delete:src/gone.ts',
      }),
    )
    expect(gateToolPermission).not.toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fs.write',
      }),
    )
    expect(result).toEqual({ rejected: true, error: 'Patch not approved' })
    expect(fsApplyPatch).not.toHaveBeenCalled()
    expect(notifyWorkspaceFsMutation).not.toHaveBeenCalled()
  })

  it('apply_patch mixed preview skips apply when the write gate rejects', async () => {
    gateToolPermission.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const result = await execute(applyPatch(baseCtx()), {
      patch: '*** Update File: src/edited.ts\n@@\n-old\n+new',
    })

    expect(gateToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fs.delete',
        capability: 'fs.delete:src/gone.ts',
      }),
    )
    expect(gateToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fs.write',
        capability: 'fs.write:*',
        paths: ['src/added.ts', 'src/moved.ts', 'src/edited.ts'],
      }),
    )
    expect(result).toEqual({ rejected: true, error: 'Patch not approved' })
    expect(fsApplyPatch).not.toHaveBeenCalled()
    expect(notifyWorkspaceFsMutation).not.toHaveBeenCalled()
  })

  it('apply_patch does not notify when the permission gate rejects', async () => {
    gateToolPermission.mockResolvedValue(false)
    const result = await execute(applyPatch(baseCtx()), {
      patch: '*** Update File: src/edited.ts\n@@\n-old\n+new',
    })

    expect(result).toEqual({ rejected: true, error: 'Patch not approved' })
    expect(fsApplyPatch).not.toHaveBeenCalled()
    expect(notifyWorkspaceFsMutation).not.toHaveBeenCalled()
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

  const groupCtx = (): HarnessToolContext => ({
    ...baseCtx(),
    projectRoot: '/tmp/api',
    projectSlug: 'stack',
    members: [api, web],
  })

  it('write_file notifies the mutated member root with a relative path', async () => {
    fsStagePreviewWrite.mockResolvedValue([emptyDiff('web/src/foo.ts', 'create')])
    await execute(writeFile(groupCtx()), {
      path: 'web/src/foo.ts',
      content: 'next',
    })

    expect(notifyWorkspaceFsMutation).toHaveBeenCalledWith('/tmp/web', ['src/foo.ts'])
    expect(notifyWorkspaceFsMutation).not.toHaveBeenCalledWith(
      '/tmp/api',
      expect.anything(),
    )
  })

  it('delete_file notifies the mutated member root with a relative path', async () => {
    fsStagePreviewDelete.mockResolvedValue([emptyDiff('web/src/foo.ts', 'delete')])
    await execute(deleteFile(groupCtx()), { path: 'web/src/foo.ts' })

    expect(notifyWorkspaceFsMutation).toHaveBeenCalledWith('/tmp/web', ['src/foo.ts'])
  })

  it('move_file rejects cross-member moves without notifying', async () => {
    const result = await execute(moveFile(groupCtx()), {
      from: 'api/src/a.ts',
      to: 'web/lib/b.ts',
    })

    expect(result).toEqual({
      error: 'Move paths must belong to a single project member',
    })
    expect(gateToolPermission).not.toHaveBeenCalled()
    expect(captureBaselinesBeforeMutate).not.toHaveBeenCalled()
    expect(fsMove).not.toHaveBeenCalled()
    expect(notifyWorkspaceFsMutation).not.toHaveBeenCalled()
  })

  it('move_file notifies the member root for a same-member move', async () => {
    const result = await execute(moveFile(groupCtx()), {
      from: 'api/src/a.ts',
      to: 'api/lib/b.ts',
    })

    expect(result).toEqual(
      expect.objectContaining({ ok: true, from: 'api/src/a.ts', to: 'api/lib/b.ts' }),
    )
    expect(fsMove).toHaveBeenCalled()
    expect(notifyWorkspaceFsMutation).toHaveBeenCalledWith('/tmp/api', ['src/a.ts', 'lib/b.ts'])
    expect(notifyWorkspaceFsMutation).not.toHaveBeenCalledWith(
      '/tmp/web',
      expect.anything(),
    )
  })

  it('apply_patch notifies each member that the patch touched', async () => {
    fsStagePreviewApplyPatch.mockResolvedValue([
      emptyDiff('api/src/added.ts', 'create'),
      emptyDiff('web/src/edited.ts', 'update'),
    ])
    await execute(applyPatch(groupCtx()), {
      patch: '*** Update File: web/src/edited.ts\n@@\n-old\n+new',
    })

    expect(notifyWorkspaceFsMutation).toHaveBeenCalledWith('/tmp/api', ['src/added.ts'])
    expect(notifyWorkspaceFsMutation).toHaveBeenCalledWith('/tmp/web', ['src/edited.ts'])
  })
})
