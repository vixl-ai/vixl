import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { FileDiff } from '@/types/harness/file-diff'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

type GateToolPermissionArgs = Parameters<
  typeof import('@/services/harness/permission/gate').gateToolPermission
>[0]
const gateToolPermission = vi.hoisted(() =>
  vi.fn<(args: GateToolPermissionArgs) => Promise<boolean>>(),
)
const captureBaselinesBeforeMutate = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
)
const fsStagePreviewEdit = vi.hoisted(() =>
  vi.fn<
    (args: {
      projectRoot: string
      path: string
      replacements: Array<{ oldString: string; newString: string }>
    }) => Promise<FileDiff[]>
  >(),
)
const fsEditFile = vi.hoisted(() =>
  vi.fn<
    (args: {
      projectRoot: string
      path: string
      replacements: Array<{ oldString: string; newString: string }>
    }) => Promise<FileDiff>
  >(),
)

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
    fsStagePreviewEdit,
    fsEditFile,
  }),
)

import editFile from '@/services/harness/edit/file'

const previewDiff: FileDiff = {
  path: 'src/main.ts',
  operation: 'update',
  oldContent: 'before',
  newContent: 'preview',
  hunks: [],
}

const appliedDiff: FileDiff = {
  path: 'src/main.ts',
  operation: 'update',
  oldContent: 'before',
  newContent: 'landed',
  hunks: [],
}

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

const execute = (
  tool: { execute?: unknown },
  input: Record<string, unknown>,
  toolCallId: string,
): Promise<unknown> => {
  const runner = tool.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId })
}

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve = (): void => undefined
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('edit_file', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gateToolPermission.mockResolvedValue(true)
    fsStagePreviewEdit.mockResolvedValue([previewDiff])
    fsEditFile.mockResolvedValue(appliedDiff)
  })

  it('returns the post-apply diff instead of the preview diff', async () => {
    const result = await execute(
      editFile(baseCtx()),
      { path: 'src/main.ts', old_string: 'before', new_string: 'landed' },
      'call-1',
    )
    expect(result).toEqual({
      ok: true,
      path: 'src/main.ts',
      diffs: [appliedDiff],
    })
    expect(gateToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        diff: [previewDiff],
      }),
    )
  })

  it('serializes same-path preview plus apply and captures after approval', async () => {
    const holdApply = deferred()
    let applyStarted = 0
    fsEditFile.mockImplementation(async () => {
      applyStarted += 1
      if (applyStarted === 1) {
        await holdApply.promise
      }
      return appliedDiff
    })
    const tool = editFile(baseCtx())
    const first = execute(
      tool,
      { path: 'src/main.ts', old_string: 'a', new_string: 'b' },
      'call-1',
    )
    const second = execute(
      tool,
      { path: 'src/main.ts', old_string: 'b', new_string: 'c' },
      'call-2',
    )
    await vi.waitFor(() => {
      expect(fsStagePreviewEdit).toHaveBeenCalledTimes(1)
      expect(captureBaselinesBeforeMutate).toHaveBeenCalledTimes(1)
      expect(applyStarted).toBe(1)
    })
    expect(captureBaselinesBeforeMutate.mock.invocationCallOrder[0]).toBeLessThan(
      fsEditFile.mock.invocationCallOrder[0]!,
    )
    holdApply.resolve()
    await Promise.all([first, second])
    expect(fsStagePreviewEdit).toHaveBeenCalledTimes(2)
    expect(fsEditFile).toHaveBeenCalledTimes(2)
    expect(captureBaselinesBeforeMutate).toHaveBeenCalledTimes(2)
    expect(fsStagePreviewEdit.mock.invocationCallOrder[1]).toBeGreaterThan(
      fsEditFile.mock.invocationCallOrder[0]!,
    )
  })

  it('keeps different paths parallel', async () => {
    const holdA = deferred()
    const holdB = deferred()
    gateToolPermission.mockImplementation(async (args) => {
      if (String(args.title).includes('a.ts')) {
        await holdA.promise
      }
      if (String(args.title).includes('b.ts')) {
        await holdB.promise
      }
      return true
    })
    const tool = editFile(baseCtx())
    const first = execute(
      tool,
      { path: 'src/a.ts', old_string: 'a', new_string: 'A' },
      'call-a',
    )
    const second = execute(
      tool,
      { path: 'src/b.ts', old_string: 'b', new_string: 'B' },
      'call-b',
    )
    await vi.waitFor(() => {
      expect(fsStagePreviewEdit).toHaveBeenCalledTimes(2)
    })
    expect(fsEditFile).not.toHaveBeenCalled()
    holdA.resolve()
    holdB.resolve()
    await Promise.all([first, second])
    expect(fsEditFile).toHaveBeenCalledTimes(2)
  })
})
