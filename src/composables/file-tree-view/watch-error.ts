import { toast } from 'vue-sonner'
import type { Ref } from 'vue'
import { treeErrorMessage } from './path-helpers'

export const looksLikeEnospc = (message: string): boolean =>
  message.toLowerCase().includes('enospc')

export const reportWatchError = (
  error: unknown,
  watchError?: Ref<string | null>,
): void => {
  const message = treeErrorMessage(error)
  toast.error('Failed to watch workspace', {
    description: message,
  })
  if (watchError && looksLikeEnospc(message)) {
    watchError.value = message
  }
}

export const retryWorkspaceWatch = async (
  root: string | null,
  start: (root: string) => Promise<void>,
  watchError?: Ref<string | null>,
): Promise<void> => {
  if (!root) {
    return
  }
  try {
    await start(root)
  } catch (error) {
    reportWatchError(error, watchError)
  }
}
