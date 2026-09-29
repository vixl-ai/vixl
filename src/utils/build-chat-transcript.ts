import type { UIMessage } from 'ai'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { ChatTimelineItem, SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import type { TodoItem } from '@/types/harness/harness-event'
import type { ToolRun } from '@/types/harness/tool-run'
import buildSubagentTimeline from '@/utils/build-subagent-timeline'
import formatTranscriptToolRun from '@/utils/format-transcript-tool-run'

type HistoryPart =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; toolCallId: string }

type HistoryCursor = {
  parts: HistoryPart[]
  index: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const partText = (part: Record<string, unknown>): string => {
  if (typeof part.text === 'string') {
    return part.text.trim()
  }
  if (typeof part.reasoning === 'string') {
    return part.reasoning.trim()
  }
  return ''
}

const flattenAssistantHistory = (messages: unknown[]): HistoryPart[] => {
  const parts: HistoryPart[] = []
  for (const message of messages) {
    if (!isRecord(message) || message.role !== 'assistant') {
      continue
    }
    const content = message.content
    if (typeof content === 'string') {
      const text = content.trim()
      if (text) {
        parts.push({ kind: 'text', text })
      }
      continue
    }
    if (!Array.isArray(content)) {
      continue
    }
    for (const raw of content) {
      if (!isRecord(raw)) {
        continue
      }
      if (raw.type === 'reasoning' || raw.type === 'text') {
        const text = partText(raw)
        if (text) {
          parts.push({ kind: 'text', text })
        }
        continue
      }
      if (raw.type === 'tool-call' && typeof raw.toolCallId === 'string') {
        parts.push({ kind: 'tool', toolCallId: raw.toolCallId })
      }
    }
  }
  return parts
}

const serializeMessageText = (message: UIMessage): string =>
  message.parts
    .map((part) => {
      if (part.type === 'text' || part.type === 'reasoning') {
        return part.text
      }
      return JSON.stringify(part)
    })
    .join('\n')
    .trim()

const serializeUser = (message: UIMessage): string => {
  const body = serializeMessageText(message)
  return `USER:\n${body || '(empty)'}`
}

const serializeAgentTurn = (turn: AgentTurn): string => {
  const parts: string[] = []
  for (const step of turn.steps) {
    // AgentStep stores reasoning, text, and tools as separate buckets.
    // Intra-step part order is not persisted.
    const reasoning = step.reasoning.trim()
    if (reasoning.length > 0) {
      parts.push(reasoning)
    }
    const text = step.text.trim()
    if (text.length > 0) {
      parts.push(text)
    }
    parts.push(...step.tools.map(formatTranscriptToolRun))
  }
  const trailingText = turn.text.trim()
  if (trailingText.length > 0) {
    parts.push(trailingText)
  }
  if (turn.error) {
    parts.push(`error (${turn.error.kind}): ${turn.error.message}`)
  }
  const body = parts.filter((value) => value.length > 0).join('\n')
  return `ASSISTANT:\n${body || '(empty)'}`
}

const serializeTodos = (todos: TodoItem[]): string => {
  const lines = todos.map((todo) => `[${todo.status}] ${todo.content}`)
  return `TODO:\n${lines.join('\n') || '(empty)'}`
}

const emitHistoryThroughTools = (
  lines: string[],
  cursor: HistoryCursor,
  tools: ToolRun[],
  toolsById: Map<string, ToolRun>,
): void => {
  const remaining = new Set(tools.map((tool) => tool.toolCallId))
  const emitted = new Set<string>()
  while (cursor.index < cursor.parts.length && remaining.size > 0) {
    const part = cursor.parts[cursor.index]!
    if (part.kind === 'tool') {
      if (!remaining.has(part.toolCallId)) {
        break
      }
      const run = toolsById.get(part.toolCallId)
      if (run) {
        lines.push(formatTranscriptToolRun(run))
      }
      remaining.delete(part.toolCallId)
      emitted.add(part.toolCallId)
      cursor.index += 1
      continue
    }
    lines.push(part.text)
    cursor.index += 1
  }
  for (const tool of tools) {
    if (!emitted.has(tool.toolCallId)) {
      lines.push(formatTranscriptToolRun(tool))
    }
  }
}

const appendSubagentEventLines = (
  lines: string[],
  item: SubagentTimelineItem,
): void => {
  const promptId = `${item.subagentId}-prompt`
  const toolsById = new Map(item.tools.map((tool) => [tool.toolCallId, tool]))
  const cursor: HistoryCursor = {
    parts: flattenAssistantHistory(item.messages ?? []),
    index: 0,
  }
  const useHistory = cursor.parts.length > 0
  for (const timelineItem of buildSubagentTimeline(item)) {
    if (timelineItem.type === 'agent-turn') {
      for (const step of timelineItem.turn.steps) {
        if (useHistory) {
          emitHistoryThroughTools(lines, cursor, step.tools, toolsById)
          continue
        }
        const reasoning = step.reasoning.trim()
        if (reasoning.length > 0) {
          lines.push(reasoning)
        }
        const text = step.text.trim()
        if (text.length > 0) {
          lines.push(text)
        }
        lines.push(...step.tools.map(formatTranscriptToolRun))
      }
      continue
    }
    if (timelineItem.type === 'compaction') {
      lines.push(`compaction: ${timelineItem.summary.trim() || '(empty)'}`)
      const focus = timelineItem.focus?.trim() ?? ''
      if (focus.length > 0) {
        lines.push(`focus: ${focus}`)
      }
      continue
    }
    if (timelineItem.type !== 'user' || timelineItem.message.id === promptId) {
      continue
    }
    const message = serializeMessageText(timelineItem.message)
    if (message.length > 0) {
      lines.push(`steer: ${message}`)
    }
  }
  while (cursor.index < cursor.parts.length) {
    const part = cursor.parts[cursor.index]!
    cursor.index += 1
    if (part.kind === 'text') {
      lines.push(part.text)
      continue
    }
    const run = toolsById.get(part.toolCallId)
    if (run) {
      lines.push(formatTranscriptToolRun(run))
    }
  }
}

const serializeSubagent = (item: SubagentTimelineItem): string => {
  const lines = [`SUBAGENT ${item.name} [${item.status}]`]
  const prompt = item.prompt?.trim() ?? ''
  if (prompt.length > 0) {
    lines.push(prompt)
  }
  appendSubagentEventLines(lines, item)
  const summary = item.summary?.trim() ?? ''
  if (summary.length > 0) {
    lines.push(`summary: ${summary}`)
  }
  return lines.join('\n')
}

const serializeCompaction = (summary: string, focus: string | null): string => {
  const lines = [`COMPACTION:\n${summary.trim() || '(empty)'}`]
  const focusText = focus?.trim() ?? ''
  if (focusText.length > 0) {
    lines.push(`focus: ${focusText}`)
  }
  return lines.join('\n')
}

const serializeItem = (item: ChatTimelineItem): string => {
  switch (item.type) {
    case 'user':
      return serializeUser(item.message)
    case 'agent-turn':
      return serializeAgentTurn(item.turn)
    case 'todo':
      return serializeTodos(item.todos)
    case 'subagent':
      return serializeSubagent(item)
    case 'compaction':
      return serializeCompaction(item.summary, item.focus)
  }
}

export default (items: ChatTimelineItem[]): string => {
  if (items.length === 0) {
    return '(empty conversation)'
  }

  return items.map(serializeItem).join('\n\n')
}
