import { toast } from 'vue-sonner'
import type { ChatStatus } from 'ai'
import type { Ref } from 'vue'
import describeAgentRunError from '@/utils/describe-agent-run-error'
import retryParentTransient from './retry-parent-transient'
import type { SendArgs, SendResult } from './send'
import { parentFailureStop, writeGuardedTurnStop } from './turn-stop'
import type { AgentHarnessSession } from './types'

type HandleSendCatchArgs = {
  err: unknown
  aborted: boolean
  turnStarted: boolean
  turnId: string | undefined
  appendedUserMessageId: string | undefined
  args: SendArgs
  status: Ref<ChatStatus>
  error: Ref<string | null>
  abortController: Ref<AbortController | null>
  session: AgentHarnessSession
  suppressQueueDrainAfterStop: Ref<boolean>
  resumeInFlight: Ref<boolean>
  projectSlug: string
  chatId: string
  refreshSlug: (slug: string) => Promise<void>
  applyTurnEndAttention: (outcome: 'success' | 'error') => void
  maybeDrainQueue: () => Promise<void>
  send: (args: SendArgs) => Promise<SendResult>
}

export default async (input: HandleSendCatchArgs): Promise<SendResult> => {
  const {
    err,
    aborted,
    turnStarted,
    turnId,
    appendedUserMessageId,
    args,
    status,
    error,
    abortController,
    session,
    suppressQueueDrainAfterStop,
    resumeInFlight,
    projectSlug,
    chatId,
    refreshSlug,
    applyTurnEndAttention,
    maybeDrainQueue,
    send,
  } = input

  const message = err instanceof Error ? err.message : 'Unknown error'
  const runDescription = describeAgentRunError(message)
  const failureStop = parentFailureStop(err)

  if (aborted) {
    status.value = 'ready'
    if (turnStarted) {
      session.finishAgentTurn()
    }
    await refreshSlug(projectSlug)
    return 'failed'
  }

  const retryResult = await retryParentTransient({
    err,
    turnStarted,
    turnId,
    appendedUserMessageId,
    autoRetryAttempt: args.autoRetryAttempt,
    mode: args.mode,
    model: args.model,
    reasoning: args.reasoning,
    originalInternal: args.internal,
    status,
    error,
    abortController,
    finishAgentTurn: () => {
      session.finishAgentTurn()
    },
    suppressQueueDrainAfterStop,
    projectSlug,
    chatId,
    session,
    refreshSlug,
    maybeDrainQueue,
    send,
  })
  if (retryResult === 'succeeded') {
    return 'completed'
  }
  if (retryResult === 'aborted' || retryResult === 'failed') {
    return 'failed'
  }

  error.value = message
  if (!resumeInFlight.value) {
    status.value = 'error'
  }
  if (turnStarted) {
    session.setAgentTurnError({
      kind: failureStop.reason === 'timeout' ? 'timeout' : 'error',
      message: failureStop.detail ?? message,
    })
    if (turnId) {
      await writeGuardedTurnStop({
        timeline: session.timeline.value,
        turnId,
        turnIdRemap: session.turnIdRemap,
        stop: failureStop,
        projectSlug,
        chatId,
        setAgentTurnStop: (id, stop) => {
          session.setAgentTurnStop(id, stop)
        },
      })
    }
    session.finishAgentTurn()
    applyTurnEndAttention('error')
  }
  toast.error('Agent run failed', {
    description: error.value.includes('No output generated')
      ? 'The model returned an empty response. Check your Gateway API key and model ID in Settings.'
      : runDescription,
  })
  await refreshSlug(projectSlug)
  return 'failed'
}
