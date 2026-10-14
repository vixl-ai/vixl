import type { HarnessEvent } from '@/types/harness/harness-event'
import { toast } from 'vue-sonner'
import {
  persistPendingSubagent,
  persistSubagentHarnessEvent,
} from './persistence'

const toastPersistError = (title: string) => (error: unknown) => {
  toast.error(title, {
    description: error instanceof Error ? error.message : 'Unknown error',
  })
}

export const createSubagentPersistQueue = (
  projectSlug: string,
  chatId: string,
) => {
  let queue: Promise<void> = Promise.resolve()

  const enqueue = (write: () => Promise<void>, title: string): void => {
    queue = queue.then(write).catch(toastPersistError(title))
  }

  const handle = (
    event: HarnessEvent,
    onEvent: (event: HarnessEvent) => void | Promise<void>,
  ): void | Promise<void> => {
    if (
      event.type === 'subagent-start' ||
      event.type === 'subagent-result' ||
      event.type === 'subagent-event'
    ) {
      enqueue(
        () => persistSubagentHarnessEvent(projectSlug, chatId, event),
        'Failed to save subagent event',
      )
    }
    if (event.type === 'pending-subagent') {
      enqueue(
        () => persistPendingSubagent(projectSlug, chatId, event),
        'Failed to save pending subagent',
      )
    }
    return onEvent(event)
  }

  return {
    handle,
    flush: (): Promise<void> => queue,
  }
}
