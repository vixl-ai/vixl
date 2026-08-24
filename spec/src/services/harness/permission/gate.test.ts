import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPendingApproval,
  listPendingApprovalsForChat,
  resetApprovalGateForTests,
  resolveApproval,
} from '@/services/harness/permission/approval-gate'
import { gateToolPermission } from '@/services/harness/permission/gate'
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
        title: 'Edit file',
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
})
