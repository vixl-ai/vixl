import { onMounted, onUnmounted, watch, type ComputedRef, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  subscribeWorkspaceFsMutations,
  workspaceFsMutationNotice,
} from '@/services/harness/shared/notify-fs-mutation'
import { isTauri, watchWorkspacePaths } from '@/services/vixl/vixl-tauri'
import gitHeadRootsMatch from '@/utils/git-head-roots-match'
import { treeErrorMessage, type TreeNode } from './path-helpers'
import {
  directoriesToRelist,
  loadedExpandedDirectories,
  type WorkspaceTreeChanged,
} from './merge-directory-children'

type WorkspaceWatchFailed = {
  rootPath: string
  message: string
}
import { recoverTreeSyncError, relistDirectories } from './workspace-tree-relist'
import { reportWatchError, retryWorkspaceWatch } from './watch-error'
import { createWorkspaceWatchSession } from './workspace-watch-session'

const HOME_WATCH_DEBOUNCE_MS = 200
const FOCUS_RELIST_DEBOUNCE_MS = 400

export type FileTreeWorkspaceSyncState = {
  isHome: () => boolean
  tree: Ref<TreeNode | null>
  expandedPaths: Ref<Set<string>>
  selectedPath: Ref<string>
  renamingPath: Ref<string | null>
  deleteTarget: Ref<{ path: string; isDirectory: boolean } | null>
  projectRoot: ComputedRef<string | null>
  refreshGit: () => Promise<void>
  onTreeChanged: () => void
  watchError?: Ref<string | null>
}

export const bindFileTreeWorkspaceSync = (
  state: FileTreeWorkspaceSyncState,
): { retryWatch: () => Promise<void> } => {
  let pendingRelist = false
  let treeListenCancelled = false
  let unlistenTree: UnlistenFn | null = null
  let unlistenWatchFailed: UnlistenFn | null = null
  let mergeGeneration = 0
  let mergeQueue: Promise<void> = Promise.resolve()
  let homeWatchTimer: ReturnType<typeof setTimeout> | null = null
  let focusRelistTimer: ReturnType<typeof setTimeout> | null = null
  const fsMutations = subscribeWorkspaceFsMutations()

  const getGeneration = (): number => mergeGeneration

  const enqueueTreeMerge = (work: () => Promise<void>): void => {
    mergeQueue = mergeQueue.then(work).catch(recoverTreeSyncError)
  }

  const eventMatchesRoot = (eventRoot: string): boolean => {
    const canonical = watchSession.recordedCanonical()
    if (canonical && gitHeadRootsMatch(eventRoot, canonical)) {
      return true
    }
    return gitHeadRootsMatch(eventRoot, state.projectRoot.value)
  }

  const applyWorkspaceTreeChanged = async (payload: WorkspaceTreeChanged): Promise<void> => {
    if (!eventMatchesRoot(payload.rootPath)) {
      return
    }
    const currentTree = state.tree.value
    if (!currentTree) {
      pendingRelist = true
      return
    }
    const directories = directoriesToRelist(currentTree, payload, state.expandedPaths.value)
    if (directories.length === 0) {
      await state.refreshGit()
      return
    }
    await relistDirectories(state, getGeneration, directories, { refreshGit: true })
  }

  const relistLoadedExpanded = async (): Promise<void> => {
    const currentTree = state.tree.value
    if (!currentTree) {
      return
    }
    await relistDirectories(
      state,
      getGeneration,
      loadedExpandedDirectories(currentTree, state.expandedPaths.value),
      { refreshGit: false },
    )
  }

  const flushPendingRelist = (): void => {
    const currentTree = state.tree.value
    if (!pendingRelist || !currentTree) {
      return
    }
    pendingRelist = false
    enqueueTreeMerge(() =>
      relistDirectories(
        state,
        getGeneration,
        loadedExpandedDirectories(currentTree, state.expandedPaths.value),
        { refreshGit: true },
      ),
    )
  }

  const relistOnFocusDebounced = (): void => {
    if (focusRelistTimer !== null) {
      clearTimeout(focusRelistTimer)
    }
    focusRelistTimer = setTimeout(() => {
      focusRelistTimer = null
      enqueueTreeMerge(() => relistLoadedExpanded())
    }, FOCUS_RELIST_DEBOUNCE_MS)
  }

  const handleWindowFocus = (): void => {
    relistOnFocusDebounced()
  }

  const handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      relistOnFocusDebounced()
    }
  }

  const reportHomeWatchError = (error: unknown): void => {
    toast.error('Failed to watch workspace', {
      description: treeErrorMessage(error),
    })
  }

  const pushHomeWatchPaths = async (): Promise<void> => {
    if (!isTauri() || !state.isHome()) {
      return
    }
    const root = state.projectRoot.value
    if (!root || watchSession.recordedRoot() !== root) {
      return
    }
    try {
      await watchWorkspacePaths({
        projectRoot: root,
        paths: [...state.expandedPaths.value],
      })
    } catch (error) {
      reportHomeWatchError(error)
    }
  }

  const pushHomeWatchPathsDebounced = (): void => {
    if (homeWatchTimer !== null) {
      clearTimeout(homeWatchTimer)
    }
    homeWatchTimer = setTimeout(() => {
      homeWatchTimer = null
      void pushHomeWatchPaths()
    }, HOME_WATCH_DEBOUNCE_MS)
  }

  const watchSession = createWorkspaceWatchSession({
    isHome: () => state.isHome(),
    watchError: state.watchError,
    onShallowReady: () => pushHomeWatchPaths(),
    onSwitch: () => {
      mergeGeneration += 1
      pendingRelist = false
    },
  })

  const subscribeWorkspaceTreeChanged = async (): Promise<void> => {
    if (!isTauri()) {
      return
    }
    const unlisten = await listen<WorkspaceTreeChanged>('workspace-tree-changed', (event) => {
      enqueueTreeMerge(() => applyWorkspaceTreeChanged(event.payload))
    })
    const unlistenFailed = await listen<WorkspaceWatchFailed>(
      'workspace-watch-failed',
      (event) => {
        if (!eventMatchesRoot(event.payload.rootPath)) {
          return
        }
        reportWatchError(event.payload.message, state.watchError)
        if (state.watchError) {
          state.watchError.value = event.payload.message
        }
      },
    )
    if (treeListenCancelled) {
      unlisten()
      unlistenFailed()
      return
    }
    unlistenTree = unlisten
    unlistenWatchFailed = unlistenFailed
  }

  onMounted(() => {
    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const root = state.projectRoot.value
    if (root) {
      watchSession.start(root).catch((error) => reportWatchError(error, state.watchError))
    }
    subscribeWorkspaceTreeChanged().catch((error) => {
      if (treeListenCancelled) {
        recoverTreeSyncError(error)
        return
      }
      toast.error('Failed to subscribe to file tree changes', {
        description: treeErrorMessage(error),
      })
    })
  })

  onUnmounted(() => {
    watchSession.cancel()
    treeListenCancelled = true
    mergeGeneration += 1
    pendingRelist = false
    fsMutations.dispose()
    window.removeEventListener('focus', handleWindowFocus)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    unlistenTree?.()
    unlistenTree = null
    unlistenWatchFailed?.()
    unlistenWatchFailed = null
    if (homeWatchTimer !== null) {
      clearTimeout(homeWatchTimer)
      homeWatchTimer = null
    }
    if (focusRelistTimer !== null) {
      clearTimeout(focusRelistTimer)
      focusRelistTimer = null
    }
    const root = watchSession.recordedRoot()
    if (root) {
      watchSession.stop(root).catch(recoverTreeSyncError)
    }
  })

  watch(
    () => ({ root: state.projectRoot.value, shallow: state.isHome() }),
    (next, previous) => {
      watchSession
        .switchTo(
          previous?.root ?? null,
          next.root,
          previous ? previous.shallow : watchSession.recordedShallow(),
          next.shallow,
        )
        .catch(recoverTreeSyncError)
    },
  )

  watch(state.tree, () => {
    flushPendingRelist()
  })

  watch(state.expandedPaths, () => {
    if (!state.isHome()) {
      return
    }
    pushHomeWatchPathsDebounced()
  })

  const retryWatch = (): Promise<void> =>
    retryWorkspaceWatch(state.projectRoot.value, watchSession.start, state.watchError)

  watch(workspaceFsMutationNotice, (notice) => {
    if (!notice) {
      return
    }
    for (const payload of fsMutations.takePending()) {
      enqueueTreeMerge(() => applyWorkspaceTreeChanged(payload))
    }
  })

  return { retryWatch }
}
