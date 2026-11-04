import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, ref } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { toast } from 'vue-sonner'
import { mockTauriEvent } from '../../test-utils/mocks/tauri-event'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import type { TreeNode } from '@/composables/file-tree-view/path-helpers'
import type { WorkspaceTreeChanged } from '@/composables/file-tree-view/merge-directory-children'
import type { FileTreeWorkspaceSyncState } from '@/composables/file-tree-view/workspace-tree-sync'

type TreeHandler = (event: { payload: WorkspaceTreeChanged }) => void
type WatchFailedHandler = (event: {
  payload: { rootPath: string; message: string }
}) => void

const isTauri = vi.hoisted(() => vi.fn<() => boolean>(() => true))
const watchWorkspace = vi.hoisted(() =>
  vi.fn<(args: { projectRoot: string; mode?: 'shallow' }) => Promise<string>>(async () => ''),
)
const unwatchWorkspace = vi.hoisted(() =>
  vi.fn<(args: { projectRoot: string }) => Promise<void>>(async () => undefined),
)
const watchWorkspacePaths = vi.hoisted(() =>
  vi.fn<(args: { projectRoot: string; paths: string[] }) => Promise<void>>(async () => undefined),
)
const fsListDir = vi.hoisted(() =>
  vi.fn<
    (
      projectRoot: string,
      path: string,
    ) => Promise<Array<{ name: string; path: string; kind: string }>>
  >(async () => []),
)
const listen = vi.hoisted(() =>
  vi.fn<(event: string, handler: TreeHandler) => Promise<() => void>>(async () => () => {}),
)

vi.mock('@tauri-apps/api/event', () => mockTauriEvent({ listen }))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    isTauri: () => isTauri(),
    watchWorkspace: (args: { projectRoot: string; mode?: 'shallow' }) => watchWorkspace(args),
    unwatchWorkspace: (args: { projectRoot: string }) => unwatchWorkspace(args),
    watchWorkspacePaths: (args: { projectRoot: string; paths: string[] }) =>
      watchWorkspacePaths(args),
    fsListDir: (projectRoot: string, path: string) => fsListDir(projectRoot, path),
  }),
)

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
  },
}))

const sampleTree = (): TreeNode => ({
  name: '.',
  path: '.',
  kind: 'directory',
  children: [
    { name: 'README.md', path: 'README.md', kind: 'file' },
    { name: 'src', path: 'src', kind: 'directory', children: [] },
  ],
})

let treeHandler: TreeHandler | null = null
let watchFailedHandler: WatchFailedHandler | null = null
let wrapper: VueWrapper | null = null
const wrappers: VueWrapper[] = []

const resetDomListeners = (): void => {
  vi.spyOn(window, 'addEventListener').mockImplementation(() => undefined)
  vi.spyOn(document, 'addEventListener').mockImplementation(() => undefined)
  vi.spyOn(window, 'removeEventListener').mockImplementation(() => undefined)
  vi.spyOn(document, 'removeEventListener').mockImplementation(() => undefined)
}

const mountSync = async (state: FileTreeWorkspaceSyncState): Promise<void> => {
  const { bindFileTreeWorkspaceSync } =
    await import('@/composables/file-tree-view/workspace-tree-sync')
  const Harness = defineComponent({
    setup() {
      bindFileTreeWorkspaceSync(state)
      return () => null
    },
  })
  wrapper = mount(Harness)
  wrappers.push(wrapper)
  await flushPromises()
}

describe('bindFileTreeWorkspaceSync', () => {
  beforeEach(() => {
    vi.resetModules()
    isTauri.mockReset()
    isTauri.mockReturnValue(true)
    watchWorkspace.mockReset()
    watchWorkspace.mockResolvedValue('/canonical/me')
    unwatchWorkspace.mockReset()
    unwatchWorkspace.mockResolvedValue(undefined)
    watchWorkspacePaths.mockReset()
    watchWorkspacePaths.mockResolvedValue(undefined)
    fsListDir.mockReset()
    fsListDir.mockResolvedValue([
      { name: 'README.md', path: 'README.md', kind: 'file' },
      { name: 'src', path: 'src', kind: 'directory' },
    ])
    listen.mockReset()
    treeHandler = null
    watchFailedHandler = null
    listen.mockImplementation(async (event, handler) => {
      if (event === 'workspace-tree-changed') {
        treeHandler = handler as TreeHandler
      }
      if (event === 'workspace-watch-failed') {
        watchFailedHandler = handler as unknown as WatchFailedHandler
      }
      return () => {}
    })
    resetDomListeners()
    vi.mocked(toast.error).mockClear()
  })

  afterEach(() => {
    while (wrappers.length > 0) {
      wrappers.pop()?.unmount()
    }
    wrapper = null
    vi.restoreAllMocks()
  })

  it('releases an in-flight watch once when the tree unmounts', async () => {
    let resolveWatch: (root: string) => void = () => undefined
    watchWorkspace.mockReturnValue(
      new Promise((resolve) => {
        resolveWatch = resolve
      }),
    )
    await mountSync({
      isHome: () => false,
      tree: ref(sampleTree()),
      expandedPaths: ref(new Set(['.'])),
      selectedPath: ref(''),
      renamingPath: ref(null),
      deleteTarget: ref(null),
      projectRoot: computed(() => '/Users/me'),
      refreshGit: vi.fn<() => Promise<void>>(async () => undefined),
      onTreeChanged: vi.fn<() => void>(),
    })

    wrappers.pop()?.unmount()
    wrapper = null
    resolveWatch('/canonical/me')
    await flushPromises()

    expect(unwatchWorkspace).toHaveBeenCalledTimes(1)
    expect(unwatchWorkspace).toHaveBeenCalledWith({ projectRoot: '/canonical/me' })
  })

  it('drops a stale in-flight watch when the project changes', async () => {
    let resolveFirst: (root: string) => void = () => undefined
    watchWorkspace.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve
      }),
    )
    const projectRoot = ref('/Users/me')
    await mountSync({
      isHome: () => false,
      tree: ref(sampleTree()),
      expandedPaths: ref(new Set(['.'])),
      selectedPath: ref(''),
      renamingPath: ref(null),
      deleteTarget: ref(null),
      projectRoot: computed(() => projectRoot.value),
      refreshGit: vi.fn<() => Promise<void>>(async () => undefined),
      onTreeChanged: vi.fn<() => void>(),
    })

    watchWorkspace.mockResolvedValue('/canonical/other')
    projectRoot.value = '/Users/other'
    await flushPromises()
    resolveFirst('/canonical/me')
    await flushPromises()

    expect(unwatchWorkspace).toHaveBeenCalledTimes(1)
    expect(unwatchWorkspace).toHaveBeenCalledWith({ projectRoot: '/canonical/me' })
    expect(watchWorkspace).toHaveBeenCalledWith({ projectRoot: '/Users/other' })
  })

  it('matches workspace events against the canonical root from watch_workspace', async () => {
    const tree = ref<TreeNode | null>(sampleTree())
    const projectRoot = computed(() => '/Users/me')
    const refreshGit = vi.fn<() => Promise<void>>(async () => undefined)
    const onTreeChanged = vi.fn<() => void>()

    await mountSync({
      isHome: () => false,
      tree,
      expandedPaths: ref(new Set(['.'])),
      selectedPath: ref(''),
      renamingPath: ref(null),
      deleteTarget: ref(null),
      projectRoot,
      refreshGit,
      onTreeChanged,
    })

    expect(watchWorkspace).toHaveBeenCalledWith({ projectRoot: '/Users/me' })
    expect(treeHandler).not.toBeNull()

    treeHandler?.({
      payload: {
        rootPath: '/canonical/me',
        directories: ['.'],
        rescan: false,
      },
    })
    await flushPromises()

    expect(fsListDir).toHaveBeenCalledWith('/Users/me', '.')
    expect(onTreeChanged).toHaveBeenCalled()
  })

  it('toasts when a remote watch poller exits', async () => {
    const watchError = ref<string | null>(null)
    await mountSync({
      isHome: () => false,
      tree: ref(sampleTree()),
      expandedPaths: ref(new Set(['.'])),
      selectedPath: ref(''),
      renamingPath: ref(null),
      deleteTarget: ref(null),
      projectRoot: computed(() => '/Users/me'),
      refreshGit: vi.fn<() => Promise<void>>(async () => undefined),
      onTreeChanged: vi.fn<() => void>(),
      watchError,
    })

    watchFailedHandler?.({
      payload: { rootPath: '/canonical/me', message: 'Watch poller exited.' },
    })

    expect(toast.error).toHaveBeenCalledWith('Failed to watch workspace', {
      description: 'Watch poller exited.',
    })
    expect(watchError.value).toBe('Watch poller exited.')
  })

  it('rewatches when home mode changes for the same project root', async () => {
    const isHome = ref(true)
    const projectRoot = computed(() => '/Users/me')

    await mountSync({
      isHome: () => isHome.value,
      tree: ref(sampleTree()),
      expandedPaths: ref(new Set(['.'])),
      selectedPath: ref(''),
      renamingPath: ref(null),
      deleteTarget: ref(null),
      projectRoot,
      refreshGit: vi.fn<() => Promise<void>>(async () => undefined),
      onTreeChanged: vi.fn<() => void>(),
    })

    expect(watchWorkspace).toHaveBeenCalledWith({
      projectRoot: '/Users/me',
      mode: 'shallow',
    })
    expect(watchWorkspacePaths).toHaveBeenCalled()

    watchWorkspace.mockClear()
    unwatchWorkspace.mockClear()
    watchWorkspacePaths.mockClear()
    isHome.value = false
    await flushPromises()

    expect(unwatchWorkspace).toHaveBeenCalledWith({ projectRoot: '/canonical/me' })
    expect(watchWorkspace).toHaveBeenCalledWith({ projectRoot: '/Users/me' })
    expect(watchWorkspace).not.toHaveBeenCalledWith({
      projectRoot: '/Users/me',
      mode: 'shallow',
    })
    expect(watchWorkspacePaths).not.toHaveBeenCalled()
  })

  it('toasts when a home watch path update fails', async () => {
    watchWorkspacePaths.mockRejectedValue(new Error('watch failed'))
    const projectRoot = computed(() => '/Users/me')

    await mountSync({
      isHome: () => true,
      tree: ref(sampleTree()),
      expandedPaths: ref(new Set(['.'])),
      selectedPath: ref(''),
      renamingPath: ref(null),
      deleteTarget: ref(null),
      projectRoot,
      refreshGit: vi.fn<() => Promise<void>>(async () => undefined),
      onTreeChanged: vi.fn<() => void>(),
    })

    expect(toast.error).toHaveBeenCalledWith('Failed to watch workspace', {
      description: 'watch failed',
    })
  })

  it('relists once after load when an event arrived while the tree was empty', async () => {
    const tree = ref<TreeNode | null>(null)
    const projectRoot = computed(() => '/Users/me')
    const onTreeChanged = vi.fn<() => void>()

    await mountSync({
      isHome: () => false,
      tree,
      expandedPaths: ref(new Set(['.'])),
      selectedPath: ref(''),
      renamingPath: ref(null),
      deleteTarget: ref(null),
      projectRoot,
      refreshGit: vi.fn<() => Promise<void>>(async () => undefined),
      onTreeChanged,
    })

    treeHandler?.({
      payload: {
        rootPath: '/canonical/me',
        directories: ['.'],
        rescan: false,
      },
    })
    await flushPromises()
    expect(fsListDir).not.toHaveBeenCalled()

    tree.value = sampleTree()
    await flushPromises()

    expect(fsListDir).toHaveBeenCalledTimes(1)
    expect(fsListDir).toHaveBeenCalledWith('/Users/me', '.')
    expect(onTreeChanged).toHaveBeenCalled()
  })

  it('relists the parent directory when a harness fs mutation is published', async () => {
    const tree = ref<TreeNode | null>(sampleTree())
    const projectRoot = computed(() => '/Users/me')
    const onTreeChanged = vi.fn<() => void>()

    await mountSync({
      isHome: () => false,
      tree,
      expandedPaths: ref(new Set(['.'])),
      selectedPath: ref(''),
      renamingPath: ref(null),
      deleteTarget: ref(null),
      projectRoot,
      refreshGit: vi.fn<() => Promise<void>>(async () => undefined),
      onTreeChanged,
    })

    fsListDir.mockClear()
    const { notifyWorkspaceFsMutation } =
      await import('@/services/harness/shared/notify-fs-mutation')
    notifyWorkspaceFsMutation('/Users/me', ['src/new.ts'])
    await flushPromises()

    expect(fsListDir).toHaveBeenCalledWith('/Users/me', 'src')
    expect(onTreeChanged).toHaveBeenCalled()
  })

  it('relists directories from every harness mutation published in the same tick', async () => {
    const tree = ref<TreeNode | null>({
      name: '.',
      path: '.',
      kind: 'directory',
      children: [
        { name: 'src', path: 'src', kind: 'directory', children: [] },
        { name: 'lib', path: 'lib', kind: 'directory', children: [] },
      ],
    })
    const projectRoot = computed(() => '/Users/me')
    const onTreeChanged = vi.fn<() => void>()

    await mountSync({
      isHome: () => false,
      tree,
      expandedPaths: ref(new Set(['.'])),
      selectedPath: ref(''),
      renamingPath: ref(null),
      deleteTarget: ref(null),
      projectRoot,
      refreshGit: vi.fn<() => Promise<void>>(async () => undefined),
      onTreeChanged,
    })

    fsListDir.mockClear()
    fsListDir.mockImplementation(async (_root, path) => {
      if (path === '.') {
        return [
          { name: 'src', path: 'src', kind: 'directory' },
          { name: 'lib', path: 'lib', kind: 'directory' },
        ]
      }
      return []
    })
    const { notifyWorkspaceFsMutation } =
      await import('@/services/harness/shared/notify-fs-mutation')
    notifyWorkspaceFsMutation('/Users/me', ['src/a.ts'])
    notifyWorkspaceFsMutation('/Users/me', ['lib/b.ts'])
    await flushPromises()

    expect(fsListDir).toHaveBeenCalledWith('/Users/me', 'src')
    expect(fsListDir).toHaveBeenCalledWith('/Users/me', 'lib')
    expect(onTreeChanged).toHaveBeenCalled()
  })

  it('relists the forward-slash parent when a harness path uses backslashes', async () => {
    const tree = ref<TreeNode | null>(sampleTree())
    const projectRoot = computed(() => '/Users/me')
    const onTreeChanged = vi.fn<() => void>()

    await mountSync({
      isHome: () => false,
      tree,
      expandedPaths: ref(new Set(['.'])),
      selectedPath: ref(''),
      renamingPath: ref(null),
      deleteTarget: ref(null),
      projectRoot,
      refreshGit: vi.fn<() => Promise<void>>(async () => undefined),
      onTreeChanged,
    })

    fsListDir.mockClear()
    const { notifyWorkspaceFsMutation } =
      await import('@/services/harness/shared/notify-fs-mutation')
    notifyWorkspaceFsMutation('/Users/me', ['src\\new.ts'])
    await flushPromises()

    expect(fsListDir).toHaveBeenCalledWith('/Users/me', 'src')
    expect(onTreeChanged).toHaveBeenCalled()
  })

  it('applies a harness mutation to the matching tree when another tree is also mounted', async () => {
    watchWorkspace.mockImplementation(async (args) => args.projectRoot)
    const otherChanged = vi.fn<() => void>()
    const matchingChanged = vi.fn<() => void>()

    await mountSync({
      isHome: () => false,
      tree: ref(sampleTree()),
      expandedPaths: ref(new Set(['.'])),
      selectedPath: ref(''),
      renamingPath: ref(null),
      deleteTarget: ref(null),
      projectRoot: computed(() => '/other'),
      refreshGit: vi.fn<() => Promise<void>>(async () => undefined),
      onTreeChanged: otherChanged,
    })
    await mountSync({
      isHome: () => false,
      tree: ref(sampleTree()),
      expandedPaths: ref(new Set(['.'])),
      selectedPath: ref(''),
      renamingPath: ref(null),
      deleteTarget: ref(null),
      projectRoot: computed(() => '/Users/me'),
      refreshGit: vi.fn<() => Promise<void>>(async () => undefined),
      onTreeChanged: matchingChanged,
    })

    fsListDir.mockClear()
    const { notifyWorkspaceFsMutation } =
      await import('@/services/harness/shared/notify-fs-mutation')
    notifyWorkspaceFsMutation('/Users/me', ['src/new.ts'])
    await flushPromises()

    expect(fsListDir).toHaveBeenCalledWith('/Users/me', 'src')
    expect(fsListDir).not.toHaveBeenCalledWith('/other', 'src')
    expect(matchingChanged).toHaveBeenCalled()
    expect(otherChanged).not.toHaveBeenCalled()
  })

  it('delivers the same harness mutation to every mounted matching tree', async () => {
    const firstChanged = vi.fn<() => void>()
    const secondChanged = vi.fn<() => void>()

    await mountSync({
      isHome: () => false,
      tree: ref(sampleTree()),
      expandedPaths: ref(new Set(['.'])),
      selectedPath: ref(''),
      renamingPath: ref(null),
      deleteTarget: ref(null),
      projectRoot: computed(() => '/Users/me'),
      refreshGit: vi.fn<() => Promise<void>>(async () => undefined),
      onTreeChanged: firstChanged,
    })
    await mountSync({
      isHome: () => false,
      tree: ref(sampleTree()),
      expandedPaths: ref(new Set(['.'])),
      selectedPath: ref(''),
      renamingPath: ref(null),
      deleteTarget: ref(null),
      projectRoot: computed(() => '/Users/me'),
      refreshGit: vi.fn<() => Promise<void>>(async () => undefined),
      onTreeChanged: secondChanged,
    })

    fsListDir.mockClear()
    const { notifyWorkspaceFsMutation } =
      await import('@/services/harness/shared/notify-fs-mutation')
    notifyWorkspaceFsMutation('/Users/me', ['src/new.ts'])
    await flushPromises()

    expect(fsListDir.mock.calls.filter((call) => call[1] === 'src')).toHaveLength(2)
    expect(firstChanged).toHaveBeenCalled()
    expect(secondChanged).toHaveBeenCalled()
  })

  it('sets watchError on inotify ENOSPC and does not poll', async () => {
    watchWorkspace.mockRejectedValue(new Error('inotify ENOSPC on eva.local.'))
    const watchError = ref<string | null>(null)

    await mountSync({
      isHome: () => false,
      tree: ref(sampleTree()),
      expandedPaths: ref(new Set(['.'])),
      selectedPath: ref(''),
      renamingPath: ref(null),
      deleteTarget: ref(null),
      projectRoot: computed(() => 'ssh://aidanhibbard@eva.local/home/aidanhibbard/proj'),
      refreshGit: vi.fn<() => Promise<void>>(async () => undefined),
      onTreeChanged: vi.fn<() => void>(),
      watchError,
    })

    expect(watchError.value).toBe('inotify ENOSPC on eva.local.')
    expect(watchWorkspace).toHaveBeenCalledTimes(1)
  })
})
