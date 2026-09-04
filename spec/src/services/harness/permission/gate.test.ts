import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPendingApproval,
  listPendingApprovalsForChat,
  resetApprovalGateForTests,
  resolveApproval,
} from '@/services/harness/permission/approval-gate'
import { gateToolPermission } from '@/services/harness/permission/gate'
import type { PermissionCapabilityKey } from '@/types/harness/permission'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

describe('gateToolPermission sticky shell elevation', () => {
  beforeEach(() => {
    resetApprovalGateForTests()
  })

  const makeCtx = () => ({
    chatId: 'chat-1',
    settings: { version: 1 } as VixlSettings,
    permissionLevel: 'ask' as const,
    sessionAllows: new Set<string>(),
    sessionDenies: new Set<string>(),
    sandboxEnabled: true,
    onPendingApproval: vi.fn<() => void>(),
  })

  const waitForPending = async (toolCallId: string): Promise<void> => {
    await vi.waitFor(() => {
      expect(getPendingApproval(toolCallId)).toBeDefined()
    })
  }

  it('adds shell.network to sessionAllows on once', async () => {
    const ctx = makeCtx()
    const pending = gateToolPermission({
      ctx,
      toolCallId: 'tc-net',
      name: 'run_terminal',
      kind: 'shell',
      action: 'shell.network',
      capability: 'shell.network',
      title: 'curl localhost',
    })
    await waitForPending('tc-net')
    resolveApproval('tc-net', { approved: true, scope: 'once' })
    await expect(pending).resolves.toBe(true)
    expect(ctx.sessionAllows.has('shell.network')).toBe(true)
  })

  it('adds shell.unsandboxed to sessionAllows on once', async () => {
    const ctx = makeCtx()
    const pending = gateToolPermission({
      ctx,
      toolCallId: 'tc-un',
      name: 'run_terminal',
      kind: 'shell',
      action: 'shell.unsandboxed',
      capability: 'shell.unsandboxed',
      title: 'ss -tlnp',
      unsandboxed: true,
    })
    await waitForPending('tc-un')
    resolveApproval('tc-un', { approved: true, scope: 'once' })
    await expect(pending).resolves.toBe(true)
    expect(ctx.sessionAllows.has('shell.unsandboxed')).toBe(true)
  })

  it('does not add sandboxed shell to sessionAllows on once', async () => {
    const ctx = makeCtx()
    const pending = gateToolPermission({
      ctx,
      toolCallId: 'tc-shell',
      name: 'run_terminal',
      kind: 'shell',
      action: 'shell',
      capability: 'shell',
      title: 'echo hi',
    })
    await waitForPending('tc-shell')
    resolveApproval('tc-shell', { approved: true, scope: 'once' })
    await expect(pending).resolves.toBe(true)
    expect(ctx.sessionAllows.has('shell')).toBe(false)
  })

  it('adds sandboxed shell to sessionAllows on session', async () => {
    const ctx = makeCtx()
    const pending = gateToolPermission({
      ctx,
      toolCallId: 'tc-shell-session',
      name: 'run_terminal',
      kind: 'shell',
      action: 'shell',
      capability: 'shell',
      title: 'echo hi',
    })
    await waitForPending('tc-shell-session')
    resolveApproval('tc-shell-session', { approved: true, scope: 'session' })
    await expect(pending).resolves.toBe(true)
    expect(ctx.sessionAllows.has('shell')).toBe(true)
  })

  it('calls onPendingApproval with the view payload', async () => {
    const ctx = makeCtx()
    const pending = gateToolPermission({
      ctx,
      toolCallId: 'tc-edit',
      name: 'edit_file',
      kind: 'fs',
      action: 'fs.write',
      capability: 'fs.write:src/a.ts',
      title: 'Edit file',
    })
    await waitForPending('tc-edit')
    expect(ctx.onPendingApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tc-edit',
        name: 'edit_file',
        kind: 'fs',
        title: 'Edit files in this workspace',
        needsNetwork: undefined,
      }),
    )
    resolveApproval('tc-edit', { approved: true, scope: 'once' })
    await expect(pending).resolves.toBe(true)
  })

  it('stores subagent attribution on the pending approval', async () => {
    const ctx = {
      ...makeCtx(),
      subagentId: 'sa-1',
      subagentLabel: 'Explorer',
    }
    const pending = gateToolPermission({
      ctx,
      toolCallId: 'tc-sub',
      name: 'edit_file',
      kind: 'fs',
      action: 'fs.write',
      capability: 'fs.write:src/a.ts',
      title: 'Edit file',
    })
    await waitForPending('tc-sub')
    expect(ctx.onPendingApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tc-sub',
        subagentId: 'sa-1',
        subagentLabel: 'Explorer',
      }),
    )
    const listed = listPendingApprovalsForChat('chat-1')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.subagentId).toBe('sa-1')
    expect(listed[0]?.subagentLabel).toBe('Explorer')
    resolveApproval('tc-sub', { approved: true, scope: 'once' })
    await expect(pending).resolves.toBe(true)
  })

  it('sets needsNetwork on the view when capability is shell.network', async () => {
    const ctx = makeCtx()
    const pending = gateToolPermission({
      ctx,
      toolCallId: 'tc-net-view',
      name: 'run_terminal',
      kind: 'shell',
      action: 'shell.network',
      capability: 'shell.network',
      title: 'curl example.com',
    })
    await waitForPending('tc-net-view')
    expect(ctx.onPendingApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tc-net-view',
        needsNetwork: true,
      }),
    )
    expect(getPendingApproval('tc-net-view')?.needsNetwork).toBe(true)
    resolveApproval('tc-net-view', { approved: true, scope: 'once' })
    await expect(pending).resolves.toBe(true)
  })
})

describe('gateToolPermission fs broad grants', () => {
  beforeEach(() => {
    resetApprovalGateForTests()
  })

  const makeCtx = () => ({
    chatId: 'chat-1',
    settings: { version: 1 } as VixlSettings,
    permissionLevel: 'ask' as const,
    sessionAllows: new Set<string>(),
    sessionDenies: new Set<string>(),
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

  const waitForPending = async (toolCallId: string): Promise<void> => {
    await vi.waitFor(() => {
      expect(getPendingApproval(toolCallId)).toBeDefined()
    })
  }

  it('allows a later path after session grant of fs.write', async () => {
    const ctx = makeCtx()
    const first = gateToolPermission({
      ctx,
      toolCallId: 'tc-fs-a',
      name: 'edit_file',
      kind: 'fs',
      action: 'fs.write',
      capability: 'fs.write:src/a.ts',
      title: 'Edit file',
      paths: ['src/a.ts'],
    })
    await waitForPending('tc-fs-a')
    resolveApproval('tc-fs-a', { approved: true, scope: 'session' })
    await expect(first).resolves.toBe(true)

    const second = gateToolPermission({
      ctx,
      toolCallId: 'tc-fs-b',
      name: 'edit_file',
      kind: 'fs',
      action: 'fs.write',
      capability: 'fs.write:src/b.ts',
      title: 'Edit file',
      paths: ['src/b.ts'],
    })
    await expect(second).resolves.toBe(true)
    expect(ctx.onPendingApproval).toHaveBeenCalledTimes(1)
  })

  it('adds broad fs.write on session, not the exact path', async () => {
    const ctx = makeCtx()
    const pending = gateToolPermission({
      ctx,
      toolCallId: 'tc-fs-session',
      name: 'edit_file',
      kind: 'fs',
      action: 'fs.write',
      capability: 'fs.write:src/a.ts',
      title: 'Edit file',
      paths: ['src/a.ts'],
    })
    await waitForPending('tc-fs-session')
    resolveApproval('tc-fs-session', { approved: true, scope: 'session' })
    await expect(pending).resolves.toBe(true)
    expect(ctx.sessionAllows.has('fs.write')).toBe(true)
    expect(ctx.sessionAllows.has('fs.write:src/a.ts')).toBe(false)
  })

  it('asks a non-sensitive write with a workspace title and persists broad fs.write', async () => {
    const ctx = makeCtx()
    const pending = gateToolPermission({
      ctx,
      toolCallId: 'tc-fs-ws',
      name: 'edit_file',
      kind: 'fs',
      action: 'fs.write',
      capability: 'fs.write:src/a.ts',
      title: 'Edit src/a.ts',
      paths: ['src/a.ts'],
    })
    await waitForPending('tc-fs-ws')
    expect(ctx.onPendingApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Edit files in this workspace',
      }),
    )
    expect(getPendingApproval('tc-fs-ws')?.title).toBe(
      'Edit files in this workspace',
    )
    expect(getPendingApproval('tc-fs-ws')?.capability).toBe(
      'fs.write:src/a.ts',
    )
    resolveApproval('tc-fs-ws', { approved: true, scope: 'workspace' })
    await expect(pending).resolves.toBe(true)
    expect(ctx.sessionAllows.has('fs.write')).toBe(true)
    expect(ctx.persistPermission).toHaveBeenCalledWith(
      'fs.write',
      'allow',
      'workspace',
    )
    expect(ctx.persistPermission).not.toHaveBeenCalledWith(
      'fs.write:src/a.ts',
      'allow',
      'workspace',
    )
  })

  it('persists broad fs.write on always, not the exact path', async () => {
    const ctx = makeCtx()
    const pending = gateToolPermission({
      ctx,
      toolCallId: 'tc-fs-always',
      name: 'edit_file',
      kind: 'fs',
      action: 'fs.write',
      capability: 'fs.write:src/a.ts',
      title: 'Edit src/a.ts',
      paths: ['src/a.ts'],
    })
    await waitForPending('tc-fs-always')
    expect(getPendingApproval('tc-fs-always')?.title).toBe(
      'Edit files in this workspace',
    )
    resolveApproval('tc-fs-always', { approved: true, scope: 'always' })
    await expect(pending).resolves.toBe(true)
    expect(ctx.sessionAllows.has('fs.write')).toBe(true)
    expect(ctx.persistPermission).toHaveBeenCalledWith(
      'fs.write',
      'allow',
      'always',
    )
    expect(ctx.persistPermission).not.toHaveBeenCalledWith(
      'fs.write:src/a.ts',
      'allow',
      'always',
    )
  })

  it('keeps the per-file title for a sensitive write', async () => {
    const ctx = makeCtx()
    const pending = gateToolPermission({
      ctx,
      toolCallId: 'tc-fs-env',
      name: 'edit_file',
      kind: 'fs',
      action: 'fs.write',
      capability: 'fs.write:.env',
      title: 'Edit .env',
      paths: ['.env'],
    })
    await waitForPending('tc-fs-env')
    expect(ctx.onPendingApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Edit .env',
      }),
    )
    expect(getPendingApproval('tc-fs-env')?.title).toBe('Edit .env')
    expect(getPendingApproval('tc-fs-env')?.capability).toBe('fs.write:.env')
    resolveApproval('tc-fs-env', { approved: true, scope: 'workspace' })
    await expect(pending).resolves.toBe(true)
    expect(ctx.persistPermission).toHaveBeenCalledWith(
      'fs.write',
      'allow',
      'workspace',
    )
  })

  it('skips the prompt when persisted workspace fs.write exists and sessionAllows is empty', async () => {
    const ctx = makeCtx()
    ctx.settings = {
      version: 1,
      'agent.permissions': [
        { capability: 'fs.write', verdict: 'allow', scope: 'workspace' },
      ],
    } as VixlSettings
    const allowed = await gateToolPermission({
      ctx,
      toolCallId: 'tc-fs-new-chat',
      name: 'edit_file',
      kind: 'fs',
      action: 'fs.write',
      capability: 'fs.write:src/a.ts',
      title: 'Edit src/a.ts',
      paths: ['src/a.ts'],
    })
    expect(allowed).toBe(true)
    expect(ctx.onPendingApproval).not.toHaveBeenCalled()
    expect(ctx.persistPermission).not.toHaveBeenCalled()
  })

  it('does not add fs.write to sessionAllows on once', async () => {
    const ctx = makeCtx()
    const first = gateToolPermission({
      ctx,
      toolCallId: 'tc-fs-once-a',
      name: 'edit_file',
      kind: 'fs',
      action: 'fs.write',
      capability: 'fs.write:src/a.ts',
      title: 'Edit file',
      paths: ['src/a.ts'],
    })
    await waitForPending('tc-fs-once-a')
    resolveApproval('tc-fs-once-a', { approved: true, scope: 'once' })
    await expect(first).resolves.toBe(true)
    expect(ctx.sessionAllows.has('fs.write')).toBe(false)
    expect(ctx.sessionAllows.has('fs.write:src/a.ts')).toBe(false)

    const second = gateToolPermission({
      ctx,
      toolCallId: 'tc-fs-once-b',
      name: 'edit_file',
      kind: 'fs',
      action: 'fs.write',
      capability: 'fs.write:src/b.ts',
      title: 'Edit file',
      paths: ['src/b.ts'],
    })
    await waitForPending('tc-fs-once-b')
    expect(ctx.onPendingApproval).toHaveBeenCalledTimes(2)
    resolveApproval('tc-fs-once-b', { approved: true, scope: 'once' })
    await expect(second).resolves.toBe(true)
  })

  it('does not let a session fs.write grant cover fs.delete', async () => {
    const ctx = makeCtx()
    ctx.sessionAllows.add('fs.write')
    const pending = gateToolPermission({
      ctx,
      toolCallId: 'tc-fs-del',
      name: 'delete_file',
      kind: 'fs',
      action: 'fs.delete',
      capability: 'fs.delete:src/a.ts',
      title: 'Delete file',
      paths: ['src/a.ts'],
    })
    await waitForPending('tc-fs-del')
    expect(ctx.onPendingApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Delete file',
      }),
    )
    resolveApproval('tc-fs-del', { approved: true, scope: 'once' })
    await expect(pending).resolves.toBe(true)
    expect(ctx.sessionAllows.has('fs.delete')).toBe(false)
  })
})
