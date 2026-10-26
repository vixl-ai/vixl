import collectPrefinishedBackgroundResults, {
  collectPrefinishedShellResults,
  commitPrefinishedBackgroundResults,
  commitPrefinishedShellResults,
} from './collect-prefinished-background-results'
import runParentOrchestrator from './run-parent-orchestrator'
import type { OrchestratorInput } from '@/types/harness/orchestrator-input'

type ParentTurnInput = Omit<OrchestratorInput, 'assistantId'> & {
  assistantId: string
  continueTurnId?: string
  internal?: boolean
  resumingBackgroundBatch: boolean
}

export default async (input: ParentTurnInput): Promise<void> => {
  const { internal, resumingBackgroundBatch, chatId, ...orchestratorInput } = input
  const prefinishedBackgroundResults = collectPrefinishedBackgroundResults(
    chatId,
    internal,
    resumingBackgroundBatch,
  )
  const prefinishedShellResults = collectPrefinishedShellResults(
    chatId,
    internal,
    resumingBackgroundBatch,
  )
  await runParentOrchestrator({
    ...orchestratorInput,
    chatId,
    ...(prefinishedBackgroundResults ? { prefinishedBackgroundResults } : {}),
    ...(prefinishedShellResults ? { prefinishedShellResults } : {}),
  })
  commitPrefinishedBackgroundResults(chatId, prefinishedBackgroundResults)
  commitPrefinishedShellResults(chatId, prefinishedShellResults)
}
