import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import { readChatMeta, readChatMessages } from '@/services/vixl/vixl-tauri'
import { mapMeta } from './helpers'
import { applyHydrateLine, createFlushTurn, type HydrateAccumulator } from './hydrate-lines'
import type { ChatSession } from './types'

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
  const metaRecord = await readChatMeta(session.projectSlug, session.chatId)
  session.meta.value = mapMeta(metaRecord)
  const lines = await readChatMessages(session.projectSlug, session.chatId)
  const acc: HydrateAccumulator = {
    nextMessages: [],
    nextTimeline: [],
    pendingTurn: null,
    currentStepId: null,
    pendingSubagents: [],
  }
  const flushTurn = createFlushTurn(acc)

  for (const line of lines) {
    applyHydrateLine(acc, line, flushTurn)
  }

  flushTurn()
  backfillSubagentPrompts(acc.nextTimeline)

  session.messages.value = acc.nextMessages
  session.timeline.value = acc.nextTimeline
  session.activeTurnId.value = null
  session.activeStepId.value = null
  session.pendingStepText.value = ''
  session.pendingQuestion.value = null
  session.editingMessageId.value = null
  session.editDraftText.value = ''
  session.warm = true
}

export default hydrateSessionFromDisk
