import type { Ref } from 'vue'
import { isTauri, unwatchWorkspace, watchWorkspace } from '@/services/vixl/vixl-tauri'
import { reportWatchError } from './watch-error'
import { recoverTreeSyncError } from './workspace-tree-relist'

export type WorkspaceWatchSession = {
  recordedRoot: () => string | null
  recordedCanonical: () => string | null
  recordedShallow: () => boolean | null
  start: (root: string) => Promise<void>
  stop: (root: string | null) => Promise<void>
  switchTo: (
    previousRoot: string | null,
    nextRoot: string | null,
    previousShallow: boolean | null,
    nextShallow: boolean,
  ) => Promise<void>
  cancel: () => void
}

export const createWorkspaceWatchSession = (options: {
  isHome: () => boolean
  watchError?: Ref<string | null>
  onShallowReady: () => Promise<void>
  onSwitch: () => void
}): WorkspaceWatchSession => {
  let watchedRoot: string | null = null
  let watchedCanonicalRoot: string | null = null
  let watchedShallow: boolean | null = null
  let watchCancelled = false
  let watchTicket = 0

  const clearWatchedRoot = (root: string): void => {
    if (watchedRoot !== root) {
      return
    }
    watchedRoot = null
    watchedCanonicalRoot = null
    watchedShallow = null
  }

  const stop = async (root: string | null): Promise<void> => {
    if (!isTauri() || !root) {
      return
    }
    try {
      await unwatchWorkspace({ projectRoot: watchedCanonicalRoot ?? root })
    } catch (error) {
      recoverTreeSyncError(error)
      return
    }
    clearWatchedRoot(root)
  }

  const start = async (root: string): Promise<void> => {
    if (!isTauri()) {
      return
    }
    const ticket = ++watchTicket
    if (options.watchError) {
      options.watchError.value = null
    }
    const shallow = options.isHome()
    const canonicalRoot = await watchWorkspace(
      shallow ? { projectRoot: root, mode: 'shallow' } : { projectRoot: root },
    )
    if (watchCancelled || ticket !== watchTicket) {
      await unwatchWorkspace({ projectRoot: canonicalRoot || root }).catch(recoverTreeSyncError)
      return
    }
    watchedRoot = root
    watchedCanonicalRoot = canonicalRoot || null
    watchedShallow = shallow
    if (shallow) {
      await options.onShallowReady()
    }
  }

  const switchTo = async (
    previousRoot: string | null,
    nextRoot: string | null,
    previousShallow: boolean | null,
    nextShallow: boolean,
  ): Promise<void> => {
    if (previousRoot === nextRoot && previousShallow === nextShallow) {
      return
    }
    watchTicket += 1
    options.onSwitch()
    if (previousRoot && watchedRoot) {
      await stop(previousRoot)
    }
    if (!nextRoot) {
      return
    }
    try {
      await start(nextRoot)
    } catch (error) {
      reportWatchError(error, options.watchError)
    }
  }

  return {
    recordedRoot: () => watchedRoot,
    recordedCanonical: () => watchedCanonicalRoot,
    recordedShallow: () => watchedShallow,
    start,
    stop,
    switchTo,
    cancel: () => {
      watchCancelled = true
    },
  }
}
