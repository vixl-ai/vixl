import type { ModelMessage } from 'ai'
import { throwIfAborted } from '@/services/harness/subagent/generate-support'
import { getSubagent } from '@/services/harness/subagent/registry'
import {
  TRANSIENT_MAX_RETRIES,
  isTransientError,
  transientBackoffMs,
  waitAbortAware,
} from '@/services/harness/transient-error'

const SUBAGENT_ABORT_MESSAGE = 'Subagent aborted'

export const generateTextWithTransientRetry = async <T>(args: {
  signal: AbortSignal
  subagentId: string
  generate: (messages: ModelMessage[] | undefined) => Promise<T>
}): Promise<T> => {
  let resume: ModelMessage[] | undefined
  for (let attempt = 0; attempt <= TRANSIENT_MAX_RETRIES; attempt += 1) {
    throwIfAborted(args.signal)
    try {
      return await args.generate(resume)
    } catch (error) {
      const canRetry =
        attempt < TRANSIENT_MAX_RETRIES &&
        !args.signal.aborted &&
        isTransientError(error)
      if (!canRetry) {
        throw error
      }
      await waitAbortAware(
        transientBackoffMs(attempt),
        args.signal,
        SUBAGENT_ABORT_MESSAGE,
      )
      resume = getSubagent(args.subagentId)?.messages
    }
  }
  throw new Error('Subagent generate retries exhausted')
}
