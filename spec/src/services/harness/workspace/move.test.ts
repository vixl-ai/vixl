import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { ChatMetaRecord, FleetProjectRecord } from '@/services/vixl/vixl-tauri/types'
import type { HarnessEvent } from '@/types/harness/harness-event'

const gateWorkspaceMovePermission = vi.hoisted(() =>
  vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
)

const moveChatToWorkspace = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)

const updateChatMeta = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)

const toastError = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())

vi.mock('@/services/harness/permission', () => ({
  gateWorkspaceMovePermission,
}))

vi.mock('@/services/vixl/vixl-tauri', () => ({
  moveChatToWorkspace,
  updateChatMeta,
}))

vi.mock('vue-sonner', () => ({
  toast: { error: toastError },
}))

import bindLiveToolContext from '@/services/harness/orchestrator/live-tool-context'
import { ipcProjectRoots, isMultiRootWorkspace } from '@/services/harness/tool-roots'
import moveWorkspace from '@/services/harness/workspace/move'

const movedProject = (rootPath: string, slug = 'dest'): FleetProjectRecord => ({
  id: 'proj-2',
  name: 'dest',
  slug,
  rootPath,
  lastOpened: '2026-01-01T00:00:00.000Z',
})

const movedChat = (rootPath: string, slug = 'dest'): ChatMetaRecord => ({
  id: 'chat-1',
  title: 'Chat',
  projectSlug: slug,
  projectRoot: rootPath,
  mode: 'agent',
  model: 'test',
  status: 'running',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  forkedFrom: null,
  pinned: false,
  pinnedAt: null,
})

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
  onHarnessEvent: vi.fn<(event: HarnessEvent) => void | Promise<void>>(),
})

const execute = async (
  input: Record<string, unknown>,
  ctx: HarnessToolContext = baseCtx(),
): Promise<unknown> => {
  const built = moveWorkspace(ctx)
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'call-1' })
}

describe('move_workspace tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gateWorkspaceMovePermission.mockResolvedValue(true)
    updateChatMeta.mockResolvedValue(movedChat('/tmp/dest'))
    moveChatToWorkspace.mockResolvedValue({
      project: movedProject('/tmp/dest'),
      chat: movedChat('/tmp/dest'),
    })
  })

  it('does not call Tauri when the user declines', async () => {
    gateWorkspaceMovePermission.mockResolvedValue(false)
    const ctx = baseCtx()
    const result = await execute({ rootPath: '/tmp/dest' }, ctx)

    expect(result).toEqual({
      rejected: true,
      error: 'User declined moving the workspace',
    })
    expect(moveChatToWorkspace).not.toHaveBeenCalled()
    expect(updateChatMeta).not.toHaveBeenCalled()
    expect(ctx.onHarnessEvent).not.toHaveBeenCalled()
  })

  it('calls Tauri with the resolved absolute path and mutates ctx', async () => {
    const ctx = baseCtx()
    const result = await execute({ rootPath: '/tmp/dest' }, ctx)

    expect(moveChatToWorkspace).toHaveBeenCalledWith({
      fromProjectSlug: 'project',
      chatId: 'chat-1',
      rootPath: '/tmp/dest',
    })
    expect(ctx.projectRoot).toBe('/tmp/dest')
    expect(ctx.projectSlug).toBe('dest')
    expect(updateChatMeta).toHaveBeenCalledWith('dest', 'chat-1', {
      prefixSnapshot: null,
    })
    expect(ctx.onHarnessEvent).toHaveBeenCalledWith({
      type: 'workspace-moved',
      fromProjectSlug: 'project',
      chatId: 'chat-1',
      project: {
        id: 'proj-2',
        name: 'dest',
        slug: 'dest',
        rootPath: '/tmp/dest',
      },
      projectSlug: 'dest',
      projectRoot: '/tmp/dest',
    })
    expect(result).toEqual({
      ok: true,
      message: 'Moved workspace to /tmp/dest.',
      projectSlug: 'dest',
      projectRoot: '/tmp/dest',
    })
  })

  it('clears group members on the live context after a successful move', async () => {
    const workspace = {
      projectSlug: 'stack',
      projectRoot: '/tmp/api',
      projectName: 'Stack',
      members: [
        { slug: 'api', name: 'API', rootPath: '/tmp/api' },
        { slug: 'web', name: 'Web', rootPath: '/tmp/web' },
      ],
    }
    const ctx = bindLiveToolContext(workspace, {
      chatId: 'chat-1',
      mode: 'agent',
      settings: { version: 1 } as VixlSettings,
      permissionLevel: 'ask',
      sessionAllows: new Set(),
      sessionDenies: new Set(),
      sandboxEnabled: true,
      supportsVision: false,
      onPendingApproval: () => {},
      onHarnessEvent: vi.fn<(event: HarnessEvent) => void | Promise<void>>(),
    })
    expect(isMultiRootWorkspace(ctx)).toBe(true)
    expect(ipcProjectRoots(ctx)).toEqual([
      { slug: 'api', path: '/tmp/api' },
      { slug: 'web', path: '/tmp/web' },
    ])

    const result = await execute({ rootPath: '/tmp/dest' }, ctx)

    expect(result).toMatchObject({ ok: true })
    expect(ctx.members).toBeUndefined()
    expect(workspace.members).toBeUndefined()
    expect(isMultiRootWorkspace(ctx)).toBe(false)
    expect(ipcProjectRoots(ctx)).toBeUndefined()
  })

  it('joins a relative path onto the current project root', async () => {
    const ctx = baseCtx()
    await execute({ rootPath: 'apps/api' }, ctx)

    expect(gateWorkspaceMovePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'move_workspace',
        title: 'Move this chat to api?',
        detail: '/tmp/project/apps/api',
      }),
    )
    expect(moveChatToWorkspace).toHaveBeenCalledWith({
      fromProjectSlug: 'project',
      chatId: 'chat-1',
      rootPath: '/tmp/project/apps/api',
    })
  })

  it('joins a relative path onto a windows project root', async () => {
    const ctx = baseCtx()
    ctx.projectRoot = 'C:\\Users\\proj'
    await execute({ rootPath: 'nested' }, ctx)

    expect(moveChatToWorkspace).toHaveBeenCalledWith({
      fromProjectSlug: 'project',
      chatId: 'chat-1',
      rootPath: 'C:\\Users\\proj\\nested',
    })
  })

  it('awaits onHarnessEvent before returning success', async () => {
    let resolved = false
    const ctx = baseCtx()
    ctx.onHarnessEvent = vi.fn<(event: HarnessEvent) => Promise<void>>(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20)
      })
      resolved = true
    })

    const result = await execute({ rootPath: '/tmp/dest' }, ctx)

    expect(resolved).toBe(true)
    expect(result).toEqual({
      ok: true,
      message: 'Moved workspace to /tmp/dest.',
      projectSlug: 'dest',
      projectRoot: '/tmp/dest',
    })
  })

  it('returns an error when rebind fails after the directory move', async () => {
    const ctx = baseCtx()
    ctx.onHarnessEvent = vi.fn<(event: HarnessEvent) => Promise<void>>(async () => {
      throw new Error('fleet refresh failed')
    })

    const result = await execute({ rootPath: '/tmp/dest' }, ctx)

    expect(moveChatToWorkspace).toHaveBeenCalled()
    expect(ctx.projectSlug).toBe('dest')
    expect(result).toEqual({
      error: 'Moved workspace files, but failed to rebind the session: fleet refresh failed',
    })
  })

  it('refuses on a subagent without prompting', async () => {
    const ctx = baseCtx()
    ctx.subagentId = 'sub-1'
    const result = await execute({ rootPath: '/tmp/dest' }, ctx)

    expect(result).toEqual({
      error: 'move_workspace can only run on the parent chat',
    })
    expect(gateWorkspaceMovePermission).not.toHaveBeenCalled()
    expect(moveChatToWorkspace).not.toHaveBeenCalled()
  })
})
