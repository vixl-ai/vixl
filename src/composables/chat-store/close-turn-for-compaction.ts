import { toast } from 'vue-sonner'
import type { AgentStop } from '@/types/chat/agent-stop'
import type { AgentTurn } from '@/types/chat/agent-turn'
import { persistTurnEnded } from '@/services/harness/orchestrator/persistence'
import applyAgentTurnStop from './apply-agent-turn-stop'
import type { ChatSession } from './types'

type CompactionAgent = {
  finishAgentTurn: () => void
  flushPendingStreamDeltas: () => void
  getActiveTurn: () => AgentTurn | null
  patchActiveTurn: (turn: AgentTurn) => void
}

const turnAlreadyStopped = (session: ChatSession, turnId: string): boolean => {
  for (let index = session.timeline.value.length - 1; index >= 0; index -= 1) {
    const item = session.timeline.value[index]
    if (item?.type === 'agent-turn' && item.turn.id === turnId) {
      return item.turn.stop != null
    }
  }
  return false
}

const closeTurnForCompaction = async (
  session: ChatSession,
  agent: CompactionAgent,
  summary: string,
  focus: string | null,
): Promise<void> => {
  const closingTurnId = session.activeTurnId.value
  agent.finishAgentTurn()
  session.timeline.value = [
    ...session.timeline.value,
    { type: 'compaction', summary, focus },
  ]
  if (!closingTurnId) {
    return
  }
  const nextTurnId = crypto.randomUUID()
  const stop: AgentStop = { reason: 'compaction' }
  const alreadyStopped = turnAlreadyStopped(session, closingTurnId)
  if (!alreadyStopped) {
    applyAgentTurnStop(session, agent, closingTurnId, stop)
  }
  session.turnIdRemap.set(closingTurnId, nextTurnId)
  session.activeTurnId.value = nextTurnId
  session.activeStepId.value = null
  session.pendingStepText.value = ''
  if (alreadyStopped) {
    return
  }
  try {
    await persistTurnEnded(session.projectSlug, session.chatId, closingTurnId, stop)
  } catch (error) {
    toast.error('Failed to save turn end', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

export default closeTurnForCompaction
