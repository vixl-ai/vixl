import { toast } from 'vue-sonner'
import type { ChatStatus } from 'ai'
import type { Ref } from 'vue'
import type { AgentStop } from '@/types/chat/agent-stop'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import {
  TRANSIENT_MAX_RETRIES,
  isTransientError,
  transientBackoffMs,
  waitAbortAware,
} from '@/services/harness/transient-error'
import type { SendArgs, SendResult } from './send'
import { writeGuardedTurnStop } from './turn-stop'
import type { AgentHarnessSession } from './types'

const CHAT_ABORT_MESSAGE = 'Chat aborted'

type RetryParentTransientArgs = {
  err: unknown
  turnStarted: boolean
  turnId: string | undefined
  appendedUserMessageId: string | undefined
  autoRetryAttempt: number | undefined
  mode: VixlChatMode
  model: string
  reasoning?: ReasoningLevel
  originalInternal: boolean | undefined
  status: Ref<ChatStatus>
  error: Ref<string | null>
  abortController: Ref<AbortController | null>
  finishAgentTurn: () => void
  suppressQueueDrainAfterStop: Ref<boolean>
  session: AgentHarnessSession
  projectSlug: string
  chatId: string
  refreshSlug: (slug: string) => Promise<void>
  maybeDrainQueue: () => Promise<void>
  send: (args: SendArgs) => Promise<SendResult>
}

type RetryParentResult =
  | 'succeeded'
  | 'failed'
  | 'aborted'
  | 'fallthrough'

export default async (
  args: RetryParentTransientArgs,
): Promise<RetryParentResult> => {
  const attempt = args.autoRetryAttempt ?? 0
  if (
    !args.turnStarted ||
    !args.turnId ||
    !args.appendedUserMessageId ||
    !isTransientError(args.err) ||
    attempt >= TRANSIENT_MAX_RETRIES
  ) {
    return 'fallthrough'
  }

  toast.info(
    `Connection dropped, retrying (${attempt + 1} of ${TRANSIENT_MAX_RETRIES})`,
  )
  args.status.value = 'submitted'
  const waitController = new AbortController()
  args.abortController.value = waitController
  let waitAborted = false
  try {
    await waitAbortAware(
      transientBackoffMs(attempt),
      waitController.signal,
      CHAT_ABORT_MESSAGE,
    )
  } catch {
    waitAborted = true
  } finally {
    if (args.abortController.value === waitController) {
      args.abortController.value = null
    }
  }
  if (waitAborted) {
    args.status.value = 'ready'
    if (args.turnId) {
      const stop: AgentStop = { reason: 'user-stop' }
      await writeGuardedTurnStop({
        timeline: args.session.timeline.value,
        turnId: args.turnId,
        turnIdRemap: args.session.turnIdRemap,
        stop,
        projectSlug: args.projectSlug,
        chatId: args.chatId,
        setAgentTurnStop: (turnId, next) => {
          args.session.setAgentTurnStop(turnId, next)
        },
      })
    }
    args.finishAgentTurn()
    await args.refreshSlug(args.projectSlug)
    return 'aborted'
  }

  const result = await args.send({
    text: '',
    mode: args.mode,
    model: args.model,
    reasoning: args.reasoning,
    continueTurnId: args.turnId,
    appendedUserMessageId: args.appendedUserMessageId,
    skipUserMessage: true,
    skipUserPersist: true,
    internal: true,
    autoRetryAttempt: attempt + 1,
  })
  if (result === 'skipped') {
    return 'fallthrough'
  }
  if (result === 'completed') {
    if (
      !args.originalInternal &&
      args.error.value == null &&
      !args.suppressQueueDrainAfterStop.value
    ) {
      await args.maybeDrainQueue()
    }
    return 'succeeded'
  }
  return 'failed'
}
