import type { ModelMessage } from 'ai'
import type {
  ChatTimelineItem,
  SubagentTimelineItem,
} from '@/types/chat/chat-timeline-item'
import type {
  SubagentRecord,
  SubagentStatus,
} from '@/types/harness/subagent-record'
import { restoreSubagent } from '@/services/harness/subagent/registry'
import { SUBAGENT_INTERRUPTED_SUMMARY } from './timeline'

const isInterruptedItem = (item: SubagentTimelineItem): boolean =>
  item.status === 'error' &&
  (item.stop?.reason === 'incomplete' ||
    item.summary === SUBAGENT_INTERRUPTED_SUMMARY)

const snapshotMessages = (
  item: SubagentTimelineItem,
  interrupted: boolean,
): ModelMessage[] | undefined => {
  if (Array.isArray(item.messages) && item.messages.length > 0) {
    return item.messages as ModelMessage[]
  }
  if (interrupted && item.prompt) {
    return [{ role: 'user', content: item.prompt }]
  }
  return undefined
}

const mappedStatus = (
  item: SubagentTimelineItem,
): { status: SubagentStatus; summary?: string } | null => {
  if (item.status === 'running') {
    return null
  }
  if (item.status === 'done') {
    return { status: 'completed', summary: item.summary }
  }
  if (isInterruptedItem(item)) {
    return { status: 'interrupted', summary: SUBAGENT_INTERRUPTED_SUMMARY }
  }
  if (item.status === 'error') {
    return { status: 'failed', summary: item.summary }
  }
  return { status: 'aborted', summary: item.summary }
}

const restoreHydratedSubagents = (
  chatId: string,
  items: ChatTimelineItem[],
): void => {
  for (const item of items) {
    if (item.type !== 'subagent') {
      continue
    }
    const mapped = mappedStatus(item)
    if (!mapped) {
      continue
    }
    const messages = snapshotMessages(item, mapped.status === 'interrupted')
    const record: SubagentRecord = {
      subagentId: item.subagentId,
      chatId,
      toolCallId: item.toolCallId ?? '',
      agentName: item.name,
      status: mapped.status,
      startedAt: item.startedAt ?? '',
      prompt: item.prompt,
      model: item.model,
      capabilities: item.capabilities,
      workspace: item.workspace,
      ...(mapped.summary
        ? {
            result: {
              subagentId: item.subagentId,
              name: item.name,
              summary: mapped.summary,
            },
          }
        : {}),
      ...(messages ? { messages } : {}),
    }
    restoreSubagent(record, { background: item.blocking === false })
  }
}

export default restoreHydratedSubagents
