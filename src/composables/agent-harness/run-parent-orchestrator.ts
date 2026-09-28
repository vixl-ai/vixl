import runOrchestrator, { continueOrchestrator } from '@/services/harness/orchestrator'
import type { OrchestratorInput } from '@/types/harness/orchestrator-input'

type ParentOrchestratorInput = Omit<OrchestratorInput, 'assistantId'> & {
  assistantId: string
  continueTurnId?: string
}

export default async (input: ParentOrchestratorInput): Promise<void> => {
  const {
    continueTurnId,
    userText,
    skipUserPersist,
    appendedUserMessageId,
    assistantId,
    ...shared
  } = input

  if (continueTurnId) {
    const userMessageId = appendedUserMessageId
    if (!userMessageId) {
      throw new Error('Cannot continue turn without a user message id')
    }
    await continueOrchestrator({
      ...shared,
      assistantId,
      userMessageId,
    })
    return
  }

  await runOrchestrator({
    ...shared,
    userText,
    appendedUserMessageId,
    skipUserPersist,
    assistantId,
  })
}
