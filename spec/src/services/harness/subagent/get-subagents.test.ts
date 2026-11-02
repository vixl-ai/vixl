import { beforeEach, describe, expect, it } from 'vitest'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { SubagentRecord } from '@/types/harness/subagent-record'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import getSubagents from '@/services/harness/subagent/get-subagents'
import {
  resetSubagentRegistryForTests,
  restoreSubagent,
} from '@/services/harness/subagent/registry'

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
  input: Record<string, unknown> = {},
  ctx: HarnessToolContext = baseCtx(),
): Promise<unknown> => {
  const built = getSubagents(ctx)
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'get-subagents-1' })
}

const seed = (
  partial: Pick<SubagentRecord, 'subagentId' | 'status' | 'startedAt'> &
    Partial<SubagentRecord>,
): void => {
  restoreSubagent({
    chatId: 'chat-1',
    toolCallId: `tc-${partial.subagentId}`,
    agentName: partial.agentName ?? partial.subagentId,
    ...partial,
  })
}

describe('get_subagents', () => {
  beforeEach(() => {
    resetSubagentRegistryForTests()
  })

  it('returns only subagentId, agentName, and status for the current chat', async () => {
    seed({
      subagentId: 'sub-a',
      status: 'completed',
      startedAt: '2020-01-03T00:00:00.000Z',
      agentName: 'explorer',
      prompt: 'secret prompt',
      model: 'local::qwen',
      capabilities: 'read-only',
      result: { subagentId: 'sub-a', name: 'explorer', summary: 'done' },
    })
    seed({
      subagentId: 'sub-other',
      chatId: 'chat-2',
      status: 'running',
      startedAt: '2020-01-04T00:00:00.000Z',
      agentName: 'other',
    })

    const result = (await execute()) as {
      subagents: Array<Record<string, unknown>>
      nextCursor: string | null
    }

    expect(result.subagents).toEqual([
      { subagentId: 'sub-a', agentName: 'explorer', status: 'completed' },
    ])
    expect(Object.keys(result.subagents[0]!)).toEqual([
      'subagentId',
      'agentName',
      'status',
    ])
    expect(result.nextCursor).toBeNull()
  })

  it('reverses the page for sort newest and sort oldest', async () => {
    seed({
      subagentId: 'sub-a',
      status: 'completed',
      startedAt: '2020-01-01T00:00:00.000Z',
    })
    seed({
      subagentId: 'sub-b',
      status: 'failed',
      startedAt: '2020-01-02T00:00:00.000Z',
    })
    seed({
      subagentId: 'sub-c',
      status: 'running',
      startedAt: '2020-01-03T00:00:00.000Z',
    })

    const newest = (await execute({ sort: 'newest' })) as {
      subagents: Array<{ subagentId: string }>
    }
    const oldest = (await execute({ sort: 'oldest' })) as {
      subagents: Array<{ subagentId: string }>
    }

    expect(newest.subagents.map((row) => row.subagentId)).toEqual([
      'sub-c',
      'sub-b',
      'sub-a',
    ])
    expect(oldest.subagents.map((row) => row.subagentId)).toEqual([
      'sub-a',
      'sub-b',
      'sub-c',
    ])
  })

  it('honors status and limit', async () => {
    seed({
      subagentId: 'sub-a',
      status: 'completed',
      startedAt: '2020-01-01T00:00:00.000Z',
    })
    seed({
      subagentId: 'sub-b',
      status: 'running',
      startedAt: '2020-01-02T00:00:00.000Z',
    })
    seed({
      subagentId: 'sub-c',
      status: 'running',
      startedAt: '2020-01-03T00:00:00.000Z',
    })

    const filtered = (await execute({ status: 'running' })) as {
      subagents: Array<{ subagentId: string; status: string }>
    }
    expect(filtered.subagents).toEqual([
      { subagentId: 'sub-c', agentName: 'sub-c', status: 'running' },
      { subagentId: 'sub-b', agentName: 'sub-b', status: 'running' },
    ])

    const limited = (await execute({ limit: 1, sort: 'oldest' })) as {
      subagents: Array<{ subagentId: string }>
      nextCursor: string | null
    }
    expect(limited.subagents.map((row) => row.subagentId)).toEqual(['sub-a'])
    expect(limited.nextCursor).toEqual(expect.any(String))
  })

  it('returns a cursor on a full page that yields the rest, and null on the last page', async () => {
    seed({
      subagentId: 'sub-a',
      status: 'completed',
      startedAt: '2020-01-01T00:00:00.000Z',
    })
    seed({
      subagentId: 'sub-b',
      status: 'completed',
      startedAt: '2020-01-02T00:00:00.000Z',
    })
    seed({
      subagentId: 'sub-c',
      status: 'completed',
      startedAt: '2020-01-03T00:00:00.000Z',
    })

    const first = (await execute({ limit: 2, sort: 'newest' })) as {
      subagents: Array<{ subagentId: string }>
      nextCursor: string | null
    }
    expect(first.subagents.map((row) => row.subagentId)).toEqual(['sub-c', 'sub-b'])
    expect(first.nextCursor).toEqual(expect.any(String))

    const rest = (await execute({
      limit: 2,
      sort: 'newest',
      cursor: first.nextCursor,
    })) as {
      subagents: Array<{ subagentId: string }>
      nextCursor: string | null
    }
    expect(rest.subagents.map((row) => row.subagentId)).toEqual(['sub-a'])
    expect(rest.nextCursor).toBeNull()
  })

  it('throws when a cursor from one sort is used with the other sort', async () => {
    seed({
      subagentId: 'sub-a',
      status: 'completed',
      startedAt: '2020-01-01T00:00:00.000Z',
    })
    seed({
      subagentId: 'sub-b',
      status: 'completed',
      startedAt: '2020-01-02T00:00:00.000Z',
    })

    const newest = (await execute({ limit: 1, sort: 'newest' })) as {
      nextCursor: string
    }

    await expect(
      execute({ limit: 1, sort: 'oldest', cursor: newest.nextCursor }),
    ).rejects.toThrow('Cursor sort does not match requested sort')
  })
})
