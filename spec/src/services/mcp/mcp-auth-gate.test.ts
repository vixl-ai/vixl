import { beforeEach, describe, expect, it } from 'vitest'
import {
  getPendingMcpAuth,
  listPendingMcpAuthForChat,
  listPendingMcpAuthForServer,
  rejectPendingMcpAuthForChat,
  requestMcpAuth,
  resetMcpAuthGateForTests,
  resolveMcpAuth,
  resolveMcpAuthForServer,
  patchPendingMcpAuthForServer,
} from '@/services/mcp/mcp-auth-gate'

describe('mcp-auth-gate', () => {
  beforeEach(() => {
    resetMcpAuthGateForTests()
  })

  it('requests and resolves authenticated', async () => {
    const pending = requestMcpAuth({
      chatId: 'chat-1',
      toolCallId: 'tool-1',
      serverId: 'github',
      scopeKey: 'personal',
      kind: 'oauth',
      title: 'Sign in to GitHub',
    })

    expect(getPendingMcpAuth('tool-1')?.serverId).toBe('github')
    expect(listPendingMcpAuthForChat('chat-1')).toHaveLength(1)

    resolveMcpAuth('tool-1', { action: 'authenticated' })
    await expect(pending).resolves.toEqual({ action: 'authenticated' })
    expect(getPendingMcpAuth('tool-1')).toBeUndefined()
  })

  it('resolves skipped', async () => {
    const pending = requestMcpAuth({
      chatId: 'chat-1',
      toolCallId: 'tool-skip',
      serverId: 'linear',
      scopeKey: 'personal',
      kind: 'inputs',
      title: 'Provide API key',
    })

    resolveMcpAuth('tool-skip', { action: 'skipped' })
    await expect(pending).resolves.toEqual({ action: 'skipped' })
  })

  it('resolves cancelled via rejectPendingMcpAuthForChat', async () => {
    const pendingA = requestMcpAuth({
      chatId: 'chat-a',
      toolCallId: 'tool-a',
      serverId: 'a',
      scopeKey: 'personal',
      kind: 'trust',
      title: 'Trust A',
    })
    const pendingB = requestMcpAuth({
      chatId: 'chat-b',
      toolCallId: 'tool-b',
      serverId: 'b',
      scopeKey: 'personal',
      kind: 'trust',
      title: 'Trust B',
    })

    rejectPendingMcpAuthForChat('chat-a')

    await expect(pendingA).resolves.toEqual({ action: 'cancelled' })
    expect(listPendingMcpAuthForChat('chat-a')).toHaveLength(0)
    expect(listPendingMcpAuthForChat('chat-b')).toHaveLength(1)

    resolveMcpAuth('tool-b', { action: 'authenticated' })
    await expect(pendingB).resolves.toEqual({ action: 'authenticated' })
  })

  it('resolveMcpAuthForServer resolves all pending for that server', async () => {
    const first = requestMcpAuth({
      chatId: 'chat-1',
      toolCallId: 'tool-1',
      serverId: 'shared',
      scopeKey: 'personal',
      kind: 'oauth',
      title: 'Auth 1',
    })
    const second = requestMcpAuth({
      chatId: 'chat-2',
      toolCallId: 'tool-2',
      serverId: 'shared',
      scopeKey: 'personal',
      kind: 'oauth',
      title: 'Auth 2',
    })
    const other = requestMcpAuth({
      chatId: 'chat-1',
      toolCallId: 'tool-3',
      serverId: 'other',
      scopeKey: 'personal',
      kind: 'oauth',
      title: 'Auth 3',
    })

    expect(listPendingMcpAuthForServer('shared')).toHaveLength(2)

    resolveMcpAuthForServer('shared', { action: 'skipped' })

    await expect(first).resolves.toEqual({ action: 'skipped' })
    await expect(second).resolves.toEqual({ action: 'skipped' })
    expect(listPendingMcpAuthForServer('shared')).toHaveLength(0)
    expect(listPendingMcpAuthForServer('other')).toHaveLength(1)

    resolveMcpAuth('tool-3', { action: 'authenticated' })
    await expect(other).resolves.toEqual({ action: 'authenticated' })
  })

  it('patches pending auth to client when DCR cannot register', async () => {
    const pending = requestMcpAuth({
      chatId: 'chat-1',
      toolCallId: 'tool-client',
      serverId: 'remote',
      scopeKey: 'personal',
      kind: 'oauth',
      title: 'Authenticate remote',
    })

    patchPendingMcpAuthForServer('remote', {
      kind: 'client',
      detail: 'This authorization server needs a client ID.',
    })

    expect(getPendingMcpAuth('tool-client')?.kind).toBe('client')
    expect(getPendingMcpAuth('tool-client')?.detail).toContain('client ID')

    resolveMcpAuth('tool-client', { action: 'authenticated' })
    await expect(pending).resolves.toEqual({ action: 'authenticated' })
  })

  it('resolveMcpAuthForServer only resolves the matching scope', async () => {
    const personal = requestMcpAuth({
      chatId: 'chat-1',
      toolCallId: 'tool-personal',
      serverId: 'github',
      scopeKey: 'personal',
      kind: 'oauth',
      title: 'Personal GitHub',
    })
    const project = requestMcpAuth({
      chatId: 'chat-1',
      toolCallId: 'tool-project',
      serverId: 'github',
      scopeKey: '/tmp/project-a',
      kind: 'oauth',
      title: 'Project GitHub',
    })

    expect(listPendingMcpAuthForServer('github', 'personal')).toHaveLength(1)
    expect(listPendingMcpAuthForServer('github', '/tmp/project-a')).toHaveLength(1)

    resolveMcpAuthForServer('github', { action: 'authenticated' }, '/tmp/project-a')

    await expect(project).resolves.toEqual({ action: 'authenticated' })
    expect(listPendingMcpAuthForServer('github', '/tmp/project-a')).toHaveLength(0)
    expect(listPendingMcpAuthForServer('github', 'personal')).toHaveLength(1)

    resolveMcpAuth('tool-personal', { action: 'cancelled' })
    await expect(personal).resolves.toEqual({ action: 'cancelled' })
  })
})
