import type { AgentStop } from '@/types/chat/agent-stop'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { ChatSession } from './types'
import { updateTimelineTurn } from './message-parsing'
import resolveTurnId from './resolve-turn-id'

type TurnStopAgent = {
  flushPendingStreamDeltas: () => void
  getActiveTurn: () => AgentTurn | null
  patchActiveTurn: (turn: AgentTurn) => void
}

const applyAgentTurnStop = (
  session: ChatSession,
  agent: TurnStopAgent,
  turnId: string,
  stop: AgentStop,
): void => {
  const resolvedId = resolveTurnId(turnId, session.turnIdRemap)
  agent.flushPendingStreamDeltas()
  const current = agent.getActiveTurn()
  if (current?.id === resolvedId) {
    if (current.stop != null) {
      return
    }
    agent.patchActiveTurn({ ...current, stop })
    return
  }
  for (let index = session.timeline.value.length - 1; index >= 0; index -= 1) {
    const item = session.timeline.value[index]
    if (item?.type !== 'agent-turn' || item.turn.id !== resolvedId) {
      continue
    }
    if (item.turn.stop != null) {
      return
    }
    updateTimelineTurn(session, { ...item.turn, stop })
    return
  }
}

export default applyAgentTurnStop
