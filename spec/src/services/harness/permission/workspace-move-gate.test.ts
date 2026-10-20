import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPendingApproval,
  resetApprovalGateForTests,
  resolveApproval,
} from '@/services/harness/permission/approval-gate'
import gateWorkspaceMovePermission from '@/services/harness/permission/workspace-move-gate'
import type {
  PermissionCapabilityKey,
  PermissionLevel,
  PermissionScope,
} from '@/types/harness/permission'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

describe('gateWorkspaceMovePermission', () => {
  beforeEach(() => {
    resetApprovalGateForTests()
  })

  const makeCtx = (overrides?: {
    permissionLevel?: PermissionLevel
    sessionAllows?: Set<string>
    sessionDenies?: Set<string>
    settings?: VixlSettings
  }) => ({
    chatId: 'chat-1',
    settings: overrides?.settings ?? ({ version: 1 } as VixlSettings),
    permissionLevel: overrides?.permissionLevel ?? ('ask' as const),
    sessionAllows: overrides?.sessionAllows ?? new Set<string>(),
    sessionDenies: overrides?.sessionDenies ?? new Set<string>(),
    sandboxEnabled: true,
    onPendingApproval: vi.fn<() => void>(),
    persistPermission: vi
      .fn<
        (
          capability: PermissionCapabilityKey,
          verdict: 'allow' | 'deny',
          scope: 'workspace' | 'always',
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined),
  })

  const startGate = (
    ctx: ReturnType<typeof makeCtx>,
    toolCallId = 'tc-move',
    extras?: {
      allowedScopes?: PermissionScope[]
      sessionKey?: string
    },
  ) =>
    gateWorkspaceMovePermission({
      ctx,
      toolCallId,
      name: 'move_workspace',
      title: 'Move this workspace',
      allowedScopes: extras?.allowedScopes,
      sessionKey: extras?.sessionKey,
    })

  const waitForPending = async (toolCallId: string): Promise<void> => {
    await vi.waitFor(() => {
      expect(getPendingApproval(toolCallId)).toBeDefined()
    })
  }

  it('prompts under bypass', async () => {
    const ctx = makeCtx({ permissionLevel: 'bypass' })
    const pending = startGate(ctx)
    await waitForPending('tc-move')
    expect(ctx.onPendingApproval).toHaveBeenCalledTimes(1)
    resolveApproval('tc-move', { approved: true, scope: 'once' })
    await expect(pending).resolves.toBe(true)
  })

  it('prompts under allowlist', async () => {
    const ctx = makeCtx({ permissionLevel: 'allowlist' })
    const pending = startGate(ctx)
    await waitForPending('tc-move')
    expect(ctx.onPendingApproval).toHaveBeenCalledTimes(1)
    resolveApproval('tc-move', { approved: true, scope: 'once' })
    await expect(pending).resolves.toBe(true)
  })

  it('does not skip when sessionAllows has workspace.move', async () => {
    const ctx = makeCtx({
      sessionAllows: new Set(['workspace.move']),
    })
    const pending = startGate(ctx)
    await waitForPending('tc-move')
    expect(ctx.onPendingApproval).toHaveBeenCalledTimes(1)
    resolveApproval('tc-move', { approved: true, scope: 'once' })
    await expect(pending).resolves.toBe(true)
  })

  it('does not skip when sessionDenies has workspace.move', async () => {
    const ctx = makeCtx({
      sessionDenies: new Set(['workspace.move']),
    })
    const pending = startGate(ctx)
    await waitForPending('tc-move')
    expect(ctx.onPendingApproval).toHaveBeenCalledTimes(1)
    resolveApproval('tc-move', { approved: true, scope: 'once' })
    await expect(pending).resolves.toBe(true)
  })

  it('does not skip persisted workspace or always grants', async () => {
    const ctx = makeCtx({
      settings: {
        version: 1,
        'agent.permissions': [
          {
            capability: 'workspace.move',
            verdict: 'allow',
            scope: 'always',
          },
        ],
      } as VixlSettings,
    })
    const pending = startGate(ctx)
    await waitForPending('tc-move')
    expect(ctx.onPendingApproval).toHaveBeenCalledTimes(1)
    resolveApproval('tc-move', { approved: true, scope: 'once' })
    await expect(pending).resolves.toBe(true)
  })

  it('returns false on deny and does not persist', async () => {
    const ctx = makeCtx()
    const pending = startGate(ctx)
    await waitForPending('tc-move')
    resolveApproval('tc-move', { approved: false, scope: 'once' })
    await expect(pending).resolves.toBe(false)
    expect(ctx.persistPermission).not.toHaveBeenCalled()
    expect(ctx.sessionDenies.has('workspace.move')).toBe(false)
  })

  it('returns true on approve and does not persist', async () => {
    const ctx = makeCtx()
    const pending = startGate(ctx)
    await waitForPending('tc-move')
    expect(ctx.onPendingApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tc-move',
        name: 'move_workspace',
        kind: 'workspace',
        title: 'Move this workspace',
        allowedScopes: ['once'],
      }),
    )
    expect(getPendingApproval('tc-move')).toEqual(
      expect.objectContaining({
        kind: 'workspace',
        action: 'workspace.move',
        capability: 'workspace.move',
        allowedScopes: ['once'],
      }),
    )
    resolveApproval('tc-move', { approved: true, scope: 'once' })
    await expect(pending).resolves.toBe(true)
    expect(ctx.persistPermission).not.toHaveBeenCalled()
    expect(ctx.sessionAllows.has('workspace.move')).toBe(false)
  })

  it('still prompts after a prior once approval', async () => {
    const ctx = makeCtx()
    const first = startGate(ctx, 'tc-move-a')
    await waitForPending('tc-move-a')
    resolveApproval('tc-move-a', { approved: true, scope: 'once' })
    await expect(first).resolves.toBe(true)

    const second = startGate(ctx, 'tc-move-b')
    await waitForPending('tc-move-b')
    expect(ctx.onPendingApproval).toHaveBeenCalledTimes(2)
    resolveApproval('tc-move-b', { approved: true, scope: 'once' })
    await expect(second).resolves.toBe(true)
    expect(ctx.persistPermission).not.toHaveBeenCalled()
  })

  it('stores a sessionKey on session approve and skips the next prompt', async () => {
    const ctx = makeCtx()
    const first = startGate(ctx, 'tc-move-a', {
      allowedScopes: ['once', 'session'],
      sessionKey: 'worktree.create',
    })
    await waitForPending('tc-move-a')
    resolveApproval('tc-move-a', { approved: true, scope: 'session' })
    await expect(first).resolves.toBe(true)
    expect(ctx.sessionAllows.has('worktree.create')).toBe(true)
    expect(ctx.persistPermission).not.toHaveBeenCalled()

    const second = startGate(ctx, 'tc-move-b', {
      allowedScopes: ['once', 'session'],
      sessionKey: 'worktree.create',
    })
    await expect(second).resolves.toBe(true)
    expect(ctx.onPendingApproval).toHaveBeenCalledTimes(1)
  })

  it('does not store a sessionKey on once approve and still prompts next', async () => {
    const ctx = makeCtx()
    const first = startGate(ctx, 'tc-move-a', {
      allowedScopes: ['once', 'session'],
      sessionKey: 'worktree.create',
    })
    await waitForPending('tc-move-a')
    resolveApproval('tc-move-a', { approved: true, scope: 'once' })
    await expect(first).resolves.toBe(true)
    expect(ctx.sessionAllows.has('worktree.create')).toBe(false)

    const second = startGate(ctx, 'tc-move-b', {
      allowedScopes: ['once', 'session'],
      sessionKey: 'worktree.create',
    })
    await waitForPending('tc-move-b')
    expect(ctx.onPendingApproval).toHaveBeenCalledTimes(2)
    resolveApproval('tc-move-b', { approved: true, scope: 'once' })
    await expect(second).resolves.toBe(true)
  })

  it('does not skip when sessionAllows has workspace.move and a different sessionKey is used', async () => {
    const ctx = makeCtx({
      sessionAllows: new Set(['workspace.move']),
    })
    const pending = startGate(ctx, 'tc-move', {
      allowedScopes: ['once', 'session'],
      sessionKey: 'worktree.create',
    })
    await waitForPending('tc-move')
    expect(ctx.onPendingApproval).toHaveBeenCalledTimes(1)
    resolveApproval('tc-move', { approved: true, scope: 'once' })
    await expect(pending).resolves.toBe(true)
    expect(ctx.sessionAllows.has('worktree.create')).toBe(false)
  })

  it('returns false on deny with a sessionKey and does not store the key', async () => {
    const ctx = makeCtx()
    const pending = startGate(ctx, 'tc-move', {
      allowedScopes: ['once', 'session'],
      sessionKey: 'worktree.create',
    })
    await waitForPending('tc-move')
    resolveApproval('tc-move', { approved: false, scope: 'once' })
    await expect(pending).resolves.toBe(false)
    expect(ctx.sessionAllows.has('worktree.create')).toBe(false)
    expect(ctx.sessionDenies.has('worktree.create')).toBe(false)
    expect(ctx.persistPermission).not.toHaveBeenCalled()
  })
})
