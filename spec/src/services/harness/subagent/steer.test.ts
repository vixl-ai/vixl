import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const resumeSubagent = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{
    subagentId: string
    name: string
    status: 'running'
    note: string
  }>>(),
)

vi.mock('@/services/harness/subagent/resume', () => ({
  default: (...args: unknown[]) => resumeSubagent(...args),
}))

import steerSubagent from '@/services/harness/subagent/steer'
import { noPoll, visibleStatus } from '@/services/harness/guidance'
import {
  drainSteers,
  resetInboxForTests,
} from '@/services/harness/subagent/inbox'
import {
  abortOne,
  fail,
  register,
  resetSubagentRegistryForTests,
  resolve,
} from '@/services/harness/subagent/registry'

const resumeNote = `Resume started in the background. ${noPoll} ${visibleStatus('steered')}`

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
  onHarnessEvent: () => {},
})

const execute = (
  ctx: HarnessToolContext,
  subagentId: string,
  message: string,
  agentName = 'explorer',
): Promise<unknown> => {
  const built = steerSubagent(ctx)
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner({ subagentId, agentName, message }, { toolCallId: 'steer-1' })
}

describe('steer_subagent routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSubagentRegistryForTests()
    resetInboxForTests()
    resumeSubagent.mockResolvedValue({
      subagentId: 'sub-1',
      name: 'explorer',
      status: 'running',
      note: resumeNote,
    })
  })

  it('queues a steer when the subagent is running', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })

    await expect(execute(baseCtx(), 'sub-1', 'look at auth')).resolves.toEqual({
      subagentId: 'sub-1',
      name: 'explorer',
      status: 'running',
      note: 'Steer will be delivered at the next step boundary.',
    })
    expect(drainSteers('sub-1')).toEqual(['look at auth'])
    expect(resumeSubagent).not.toHaveBeenCalled()
  })

  it('resumes a completed subagent', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'first pass',
    })

    await expect(execute(baseCtx(), 'sub-1', 'keep going')).resolves.toEqual({
      subagentId: 'sub-1',
      name: 'explorer',
      status: 'running',
      note: resumeNote,
    })
    expect(resumeSubagent).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-1' }),
      'sub-1',
      'keep going',
    )
    expect(drainSteers('sub-1')).toEqual([])
  })

  it('resumes a failed subagent', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    fail('sub-1', 'boom')

    await expect(execute(baseCtx(), 'sub-1', 'try again')).resolves.toEqual({
      subagentId: 'sub-1',
      name: 'explorer',
      status: 'running',
      note: resumeNote,
    })
    expect(resumeSubagent).toHaveBeenCalled()
  })

  it('matches agentName case-insensitively after trim', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'Explorer',
    })

    await expect(
      execute(baseCtx(), 'sub-1', 'look at auth', '  explorer  '),
    ).resolves.toMatchObject({
      subagentId: 'sub-1',
      name: 'Explorer',
      status: 'running',
    })
    expect(drainSteers('sub-1')).toEqual(['look at auth'])
  })

  it('throws when agentName does not match the registered name', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    register('chat-1', 'sub-2', new AbortController(), {
      toolCallId: 'tc-2',
      agentName: 'writer',
    })

    await expect(
      execute(baseCtx(), 'sub-1', 'look at auth', 'writer'),
    ).rejects.toThrow(
      'Subagent sub-1 is "explorer", not "writer". Known subagents: sub-1 (explorer, running), sub-2 (writer, running)',
    )
    expect(drainSteers('sub-1')).toEqual([])
    expect(resumeSubagent).not.toHaveBeenCalled()
  })

  it('throws known ids when the subagent is unknown', async () => {
    register('chat-1', 'sub-known', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })

    await expect(execute(baseCtx(), 'missing', 'hello')).rejects.toThrow(
      'Unknown subagentId: missing. Known subagent ids for this chat: sub-known (explorer, running)',
    )
    expect(resumeSubagent).not.toHaveBeenCalled()
  })

  it('throws when the subagent cannot be steered', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    abortOne('sub-1')

    await expect(execute(baseCtx(), 'sub-1', 'hello')).rejects.toThrow(
      'Subagent sub-1 is aborted and cannot be steered.',
    )
    expect(resumeSubagent).not.toHaveBeenCalled()
  })

  it('requires agentName on the tool input schema', () => {
    const built = steerSubagent(baseCtx())
    const schema = built.inputSchema as unknown as {
      shape: { agentName: { description?: string } }
    }
    expect(schema.shape.agentName.description).toContain(
      'Name returned by spawn_subagent',
    )
  })
})
