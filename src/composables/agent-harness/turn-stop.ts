import { toast } from 'vue-sonner'
import type { AgentStop } from '@/types/chat/agent-stop'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import resolveTurnId from '@/composables/chat-store/resolve-turn-id'
import { persistTurnEnded } from '@/services/harness/orchestrator/persistence'
import describeAgentRunError from '@/utils/describe-agent-run-error'

export const agentTurnHasStop = (
  timeline: ChatTimelineItem[],
  turnId: string,
  turnIdRemap?: ReadonlyMap<string, string>,
): boolean => {
  const resolvedId = resolveTurnId(turnId, turnIdRemap)
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index]
    if (item?.type === 'agent-turn' && item.turn.id === resolvedId) {
      return item.turn.stop != null
    }
  }
  return false
}

export const parentFailureStop = (err: unknown): AgentStop => {
  const timedOut =
    err instanceof Error &&
    (err.name === 'TimeoutError' || /timeout/i.test(err.message))
  const message = err instanceof Error ? err.message : 'Unknown error'
  const detail = timedOut
    ? 'The model took too long to respond.'
    : message.includes('No output generated')
      ? 'The model returned an empty response. Check your API key and model ID in Settings.'
      : describeAgentRunError(message)
  return {
    reason: timedOut ? 'timeout' : 'error',
    detail,
  }
}

export const writeGuardedTurnStop = async (args: {
  timeline: ChatTimelineItem[]
  turnId: string
  turnIdRemap?: ReadonlyMap<string, string>
  stop: AgentStop
  projectSlug: string
  chatId: string
  setAgentTurnStop: (turnId: string, stop: AgentStop) => void
}): Promise<void> => {
  if (agentTurnHasStop(args.timeline, args.turnId, args.turnIdRemap)) {
    return
  }
  args.setAgentTurnStop(args.turnId, args.stop)
  try {
    await persistTurnEnded(args.projectSlug, args.chatId, args.turnId, args.stop)
  } catch (error) {
    toast.error('Failed to save turn end', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
