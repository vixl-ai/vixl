import { tool } from 'ai'
import { z } from 'zod'
import { listSubagentsForChat } from '@/services/harness/subagent/registry'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { SubagentRecord, SubagentStatus } from '@/types/harness/subagent-record'

const SUBAGENT_STATUSES = [
  'running',
  'completed',
  'failed',
  'aborted',
  'interrupted',
] as const satisfies readonly SubagentStatus[]

type SubagentListSort = 'newest' | 'oldest'

type SubagentListCursor = {
  sort: SubagentListSort
  startedAt: string
  subagentId: string
}

type SubagentListRow = {
  subagentId: string
  agentName: string
  status: SubagentStatus
}

const isListSort = (value: unknown): value is SubagentListSort =>
  value === 'newest' || value === 'oldest'

const encodeCursor = (cursor: SubagentListCursor): string => btoa(JSON.stringify(cursor))

const parseCursor = (raw: string, sort: SubagentListSort): SubagentListCursor => {
  let parsed: unknown
  try {
    parsed = JSON.parse(atob(raw))
  } catch {
    throw new Error('Unknown cursor')
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !isListSort((parsed as { sort?: unknown }).sort) ||
    typeof (parsed as { startedAt?: unknown }).startedAt !== 'string' ||
    typeof (parsed as { subagentId?: unknown }).subagentId !== 'string'
  ) {
    throw new Error('Unknown cursor')
  }

  const cursor = parsed as SubagentListCursor
  if (cursor.sort !== sort) {
    throw new Error('Cursor sort does not match requested sort')
  }
  return cursor
}

const compareRows = (a: SubagentRecord, b: SubagentRecord, sort: SubagentListSort): number => {
  if (a.startedAt !== b.startedAt) {
    if (sort === 'newest') {
      return a.startedAt < b.startedAt ? 1 : -1
    }
    return a.startedAt < b.startedAt ? -1 : 1
  }
  if (a.subagentId === b.subagentId) {
    return 0
  }
  return a.subagentId < b.subagentId ? -1 : 1
}

const isAfterCursor = (record: SubagentRecord, cursor: SubagentListCursor): boolean => {
  if (record.startedAt === cursor.startedAt) {
    return record.subagentId > cursor.subagentId
  }
  if (cursor.sort === 'newest') {
    return record.startedAt < cursor.startedAt
  }
  return record.startedAt > cursor.startedAt
}

const toListRow = (record: SubagentRecord): SubagentListRow => ({
  subagentId: record.subagentId,
  agentName: record.agentName,
  status: record.status,
})

const getSubagents = (ctx: HarnessToolContext) =>
  tool({
    description:
      'spawned subagents in this chat survive an app restart. Page them before spawning a replacement for the same task. Pass subagentId and agentName to steer_subagent to resume a completed, failed, or interrupted one. aborted cannot be steered. sort newest or oldest.',
    inputSchema: z.object({
      cursor: z.string().optional().describe('Opaque keyset from the previous page'),
      limit: z.number().int().min(1).max(50).default(20).describe('Page size'),
      status: z.enum(SUBAGENT_STATUSES).optional().describe('Filter by run status'),
      sort: z.enum(['newest', 'oldest']).default('newest').describe('Page order'),
    }),
    execute: async ({
      cursor,
      limit = 20,
      status,
      sort = 'newest',
    }): Promise<{
      subagents: SubagentListRow[]
      nextCursor: string | null
    }> => {
      const keyset = cursor === undefined ? null : parseCursor(cursor, sort)
      const rows = listSubagentsForChat(ctx.chatId)
        .filter((record) => (status ? record.status === status : true))
        .filter((record) => (keyset ? isAfterCursor(record, keyset) : true))
        .sort((a, b) => compareRows(a, b, sort))
      const page = rows.slice(0, limit)
      const last = page[page.length - 1]
      const nextCursor =
        last && page.length === limit && rows.length > limit
          ? encodeCursor({
              sort,
              startedAt: last.startedAt,
              subagentId: last.subagentId,
            })
          : null
      return {
        subagents: page.map(toListRow),
        nextCursor,
      }
    },
  })

export default getSubagents
