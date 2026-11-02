import type {
  ChatTimelineItem,
  SubagentTimelineItem,
} from '@/types/chat/chat-timeline-item'
import { readChatMeta, readChatMessages } from '@/services/vixl/vixl-tauri'
import { mapMeta } from './helpers'
import { applyHydrateLine, createFlushTurn } from './hydrate-lines'
import hydrateTimelineBuilder, {
  type HydratedSubagentHistory,
  type HydratedSubagentResume,
} from './hydrate-timeline-builder'
import restoreHydratedSubagents from './restore-hydrated-subagents'
import { finalizeHydratedSubagents } from './timeline'
import { clearPendingStreamDeltasForSession } from './stream-delta-buffer'
import { clearPendingSubagentStreamDeltasForSession } from './subagent-stream-delta-buffer'
import type { ChatSession } from './types'

const hasMessages = (value: unknown): value is unknown[] =>
  Array.isArray(value) && value.length > 0

const pickHydratedSubagentMessages = (
  item: SubagentTimelineItem,
  snapshot: HydratedSubagentResume,
  history: HydratedSubagentHistory | undefined,
): unknown[] | undefined => {
  if (!history) {
    return snapshot.messages
  }
  const historyAt = history.createdAt
  const resumeAt = snapshot.createdAt
  const historyMessages = hasMessages(item.messages) ? item.messages : undefined
  if (historyAt && resumeAt) {
    return historyAt > resumeAt ? history.messages : snapshot.messages
  }
  if (!resumeAt && historyMessages) {
    return historyMessages
  }
  if (!historyAt && hasMessages(snapshot.messages)) {
    return snapshot.messages
  }
  return historyMessages ?? snapshot.messages
}

const applySubagentResumes = (
  items: ChatTimelineItem[],
  resumes: Map<string, HydratedSubagentResume>,
  histories: Map<string, HydratedSubagentHistory>,
): void => {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (item?.type !== 'subagent') {
      continue
    }
    const snapshot = resumes.get(item.subagentId)
    if (!snapshot) {
      continue
    }
    items[index] = {
      ...item,
      messages: pickHydratedSubagentMessages(
        item,
        snapshot,
        histories.get(item.subagentId),
      ),
      model: snapshot.model ?? item.model,
      capabilities: snapshot.capabilities ?? item.capabilities,
      workspace: snapshot.workspace ?? item.workspace,
      ...(typeof snapshot.blocking === 'boolean'
        ? { blocking: snapshot.blocking }
        : {}),
    }
  }
}

const backfillSubagentPrompts = (nextTimeline: ChatTimelineItem[]): void => {
  const promptByToolCallId = new Map<string, string>()
  const promptBySubagentId = new Map<string, string>()
  for (const item of nextTimeline) {
    if (item.type !== 'agent-turn') {
      continue
    }
    for (const step of item.turn.steps) {
      for (const tool of step.tools) {
        if (tool.name !== 'spawn_subagent' || !tool.args || typeof tool.args !== 'object') {
          continue
        }
        const args = tool.args as Record<string, unknown>
        const prompt = typeof args.prompt === 'string' ? args.prompt : ''
        if (!prompt) {
          continue
        }
        promptByToolCallId.set(tool.toolCallId, prompt)
        if (tool.result && typeof tool.result === 'object') {
          const result = tool.result as Record<string, unknown>
          if (typeof result.subagentId === 'string') {
            promptBySubagentId.set(result.subagentId, prompt)
          }
        }
      }
    }
  }
  for (let index = 0; index < nextTimeline.length; index += 1) {
    const item = nextTimeline[index]
    if (item?.type !== 'subagent' || item.prompt) {
      continue
    }
    const fromTool =
      (item.toolCallId ? promptByToolCallId.get(item.toolCallId) : undefined) ??
      promptBySubagentId.get(item.subagentId)
    if (fromTool) {
      nextTimeline[index] = { ...item, prompt: fromTool }
    }
  }
}

const hydrateSessionFromDisk = async (session: ChatSession): Promise<void> => {
  clearPendingStreamDeltasForSession(session)
  clearPendingSubagentStreamDeltasForSession(session)
  const metaRecord = await readChatMeta(session.projectSlug, session.chatId)
  session.meta.value = mapMeta(metaRecord)
  const lines = await readChatMessages(session.projectSlug, session.chatId)
  const acc = hydrateTimelineBuilder.createAccumulator()
  const flushTurn = createFlushTurn(acc)

  for (const line of lines) {
    applyHydrateLine(acc, line, flushTurn)
  }

  flushTurn()
  applySubagentResumes(acc.nextTimeline, acc.subagentResumes, acc.subagentHistories)
  backfillSubagentPrompts(acc.nextTimeline)

  session.messages.value = acc.nextMessages
  session.timeline.value = finalizeHydratedSubagents(acc.nextTimeline)
  restoreHydratedSubagents(session.chatId, session.timeline.value)
  session.activeTurnId.value = null
  session.activeStepId.value = null
  session.pendingStepText.value = ''
  session.pendingQuestion.value = null
  session.editingMessageId.value = null
  session.editDraftText.value = ''
  session.warm = true
}

export default hydrateSessionFromDisk
