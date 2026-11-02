import { onMounted, onUnmounted, watch, type ComputedRef, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  subscribeWorkspaceFsMutations,
  workspaceFsMutationNotice,
} from '@/services/harness/shared/notify-fs-mutation'
import {
  isTauri,
  unwatchWorkspace,
  watchWorkspace,
  watchWorkspacePaths,
} from '@/services/vixl/vixl-tauri'
import gitHeadRootsMatch from '@/utils/git-head-roots-match'
import { treeErrorMessage, type TreeNode } from './path-helpers'
import {
  directoriesToRelist,
  loadedExpandedDirectories,
  type WorkspaceTreeChanged,
} from './merge-directory-children'
import { recoverTreeSyncError, relistDirectories } from './workspace-tree-relist'
import { reportWatchError, retryWorkspaceWatch } from './watch-error'

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
  let watchedRoot: string | null = null
  let watchedCanonicalRoot: string | null = null
  let watchedShallow: boolean | null = null
  let pendingRelist = false
  let watchCancelled = false
  let treeListenCancelled = false
  let unlistenTree: UnlistenFn | null = null
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
    if (watchedCanonicalRoot && gitHeadRootsMatch(eventRoot, watchedCanonicalRoot)) {
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
    if (!root || watchedRoot !== root) {
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

  const startWorkspaceWatch = async (root: string): Promise<void> => {
    if (!isTauri()) {
      return
    }
    if (state.watchError) {
      state.watchError.value = null
    }
    const shallow = state.isHome()
    const canonicalRoot = await watchWorkspace(
      shallow ? { projectRoot: root, mode: 'shallow' } : { projectRoot: root },
    )
    if (watchCancelled) {
      await unwatchWorkspace({ projectRoot: canonicalRoot || root }).catch(recoverTreeSyncError)
      return
    }
    watchedRoot = root
    watchedCanonicalRoot = canonicalRoot || null
    watchedShallow = shallow
    if (shallow) {
      await pushHomeWatchPaths()
    }
  }

  const clearWatchedRoot = (root: string): void => {
    if (watchedRoot !== root) {
      return
    }
    watchedRoot = null
    watchedCanonicalRoot = null
    watchedShallow = null
  }

  const stopWorkspaceWatch = async (root: string | null): Promise<void> => {
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

  const switchWorkspaceWatch = async (
    previousRoot: string | null,
    nextRoot: string | null,
    previousShallow: boolean | null,
    nextShallow: boolean,
  ): Promise<void> => {
    if (previousRoot === nextRoot && previousShallow === nextShallow) {
      return
    }
    mergeGeneration += 1
    pendingRelist = false
    if (previousRoot) {
      await stopWorkspaceWatch(previousRoot)
    }
    if (!nextRoot) {
      return
    }
    try {
      await startWorkspaceWatch(nextRoot)
    } catch (error) {
      reportWatchError(error, state.watchError)
    }
  }

  const subscribeWorkspaceTreeChanged = async (): Promise<void> => {
    if (!isTauri()) {
      return
    }
    const unlisten = await listen<WorkspaceTreeChanged>('workspace-tree-changed', (event) => {
      enqueueTreeMerge(() => applyWorkspaceTreeChanged(event.payload))
    })
    if (treeListenCancelled) {
      unlisten()
      return
    }
    unlistenTree = unlisten
  }

  onMounted(() => {
    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const root = state.projectRoot.value
    if (root) {
      startWorkspaceWatch(root).catch((error) => reportWatchError(error, state.watchError))
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
    watchCancelled = true
    treeListenCancelled = true
    mergeGeneration += 1
    pendingRelist = false
    fsMutations.dispose()
    window.removeEventListener('focus', handleWindowFocus)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    unlistenTree?.()
    unlistenTree = null
    if (homeWatchTimer !== null) {
      clearTimeout(homeWatchTimer)
      homeWatchTimer = null
    }
    if (focusRelistTimer !== null) {
      clearTimeout(focusRelistTimer)
      focusRelistTimer = null
    }
    const root = watchedRoot ?? state.projectRoot.value
    stopWorkspaceWatch(root).catch(recoverTreeSyncError)
  })

  watch(
    () => ({ root: state.projectRoot.value, shallow: state.isHome() }),
    (next, previous) => {
      switchWorkspaceWatch(
        previous?.root ?? null,
        next.root,
        previous ? previous.shallow : watchedShallow,
        next.shallow,
      ).catch(recoverTreeSyncError)
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
    retryWorkspaceWatch(state.projectRoot.value, startWorkspaceWatch, state.watchError)

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
