import { beforeEach, describe, expect, it } from 'vitest'
import type { PendingApproval } from '@/services/harness/permission/approval-gate'
import {
  getPendingApproval,
  listPendingApprovalsForChat,
  rejectPendingForChat,
  rejectPendingForSubagent,
  requestApproval,
  resetApprovalGateForTests,
  resolveApproval,
} from '@/services/harness/permission/approval-gate'
import {
  register,
  resetSubagentRegistryForTests,
} from '@/services/harness/subagent/registry'

const makeEntry = (
  overrides: Pick<PendingApproval, 'toolCallId'> &
    Partial<Pick<PendingApproval, 'chatId' | 'subagentId'>>,
): Omit<PendingApproval, 'resolve'> => ({
  chatId: 'chat-1',
  name: 'write_file',
  kind: 'fs',
  action: 'fs.write',
  capability: 'fs.write:a.txt',
  title: 'Write file',
  allowedScopes: ['once', 'session', 'always'],
  ...overrides,
})

describe('rejectPendingForSubagent', () => {
  beforeEach(() => {
    resetApprovalGateForTests()
    resetSubagentRegistryForTests()
  })

  it('settles only that subagent entries and leaves others pending', async () => {
    const target = requestApproval(
      makeEntry({ toolCallId: 'tool-target', subagentId: 'sa-1' }),
    )
    const otherSubagent = requestApproval(
      makeEntry({ toolCallId: 'tool-other', subagentId: 'sa-2' }),
    )
    const parent = requestApproval(makeEntry({ toolCallId: 'tool-parent' }))

    expect(listPendingApprovalsForChat('chat-1')).toHaveLength(3)

    rejectPendingForSubagent('sa-1')

    await expect(target).resolves.toEqual({ approved: false, scope: 'once' })
    expect(getPendingApproval('tool-target')).toBeUndefined()
    expect(getPendingApproval('tool-other')).toBeDefined()
    expect(getPendingApproval('tool-parent')).toBeDefined()
    expect(listPendingApprovalsForChat('chat-1')).toHaveLength(2)

    resolveApproval('tool-other', { approved: true, scope: 'once' })
    await expect(otherSubagent).resolves.toEqual({ approved: true, scope: 'once' })
    resolveApproval('tool-parent', { approved: true, scope: 'once' })
    await expect(parent).resolves.toEqual({ approved: true, scope: 'once' })
  })

  it('is a no-op for unknown ids', async () => {
    const pending = requestApproval(makeEntry({ toolCallId: 'tool-keep' }))

    rejectPendingForSubagent('unknown-subagent')

    expect(getPendingApproval('tool-keep')).toBeDefined()
    expect(listPendingApprovalsForChat('chat-1')).toHaveLength(1)

    resolveApproval('tool-keep', { approved: true, scope: 'once' })
    await expect(pending).resolves.toEqual({ approved: true, scope: 'once' })
  })
})

describe('rejectPendingForChat keepBackground', () => {
  beforeEach(() => {
    resetApprovalGateForTests()
    resetSubagentRegistryForTests()
  })

  it('skips approvals owned by a running background subagent', async () => {
    register('chat-1', 'bg-1', new AbortController(), {
      toolCallId: 'tc-bg',
      agentName: 'background',
    })
    register(
      'chat-1',
      'block-1',
      new AbortController(),
      { toolCallId: 'tc-block', agentName: 'blocking' },
      { pendingResume: false },
    )

    const parent = requestApproval(makeEntry({ toolCallId: 'tool-parent' }))
    const background = requestApproval(
      makeEntry({ toolCallId: 'tool-bg', subagentId: 'bg-1' }),
    )
    const blocking = requestApproval(
      makeEntry({ toolCallId: 'tool-block', subagentId: 'block-1' }),
    )

    rejectPendingForChat('chat-1', { keepBackground: true })

    await expect(parent).resolves.toEqual({ approved: false, scope: 'once' })
    await expect(blocking).resolves.toEqual({ approved: false, scope: 'once' })
    expect(getPendingApproval('tool-bg')).toBeDefined()
    expect(listPendingApprovalsForChat('chat-1')).toHaveLength(1)

    resolveApproval('tool-bg', { approved: true, scope: 'once' })
    await expect(background).resolves.toEqual({ approved: true, scope: 'once' })
  })
})
