import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import type { FileTreeMutationState } from '@/composables/file-tree-view/mutations'

const fsDelete = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    fsDelete: (...args: unknown[]) => fsDelete(...args),
  }),
)

const mcpStop = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)

vi.mock('@/services/mcp/mcp-runtime', () => ({
  default: {
    stop: (...args: unknown[]) => mcpStop(...args),
  },
}))

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
  },
}))

const buildState = (
  overrides: Partial<FileTreeMutationState> = {},
): FileTreeMutationState => {
  const projectRoot =
    overrides.projectRoot
    ?? computed(() => '/tmp/proj' as string | null)

  return {
    props: { projectId: 'proj-1', selectedPath: null },
    emit: vi.fn<(event: 'select', path: string) => void>(),
    tree: ref(null),
    expandedPaths: ref(new Set(['.'])),
    selectedPath: ref(''),
    renamingPath: ref(null),
    deleteTarget: ref(null),
    deleting: ref(false),
    createDialogOpen: ref(false),
    createDialogMode: ref<'file' | 'folder'>('file'),
    createName: ref(''),
    creating: ref(false),
    projectRoot,
    refresh: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ensureChildrenLoaded: vi
      .fn<(directoryPath: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('createFileTreeMutations delete', () => {
  beforeEach(() => {
    vi.resetModules()
    fsDelete.mockReset()
    fsDelete.mockResolvedValue(undefined)
    mcpStop.mockReset()
    mcpStop.mockResolvedValue(undefined)
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  it('deletes a directory with recursive true, refreshes, and toasts Folder deleted', async () => {
    const { createFileTreeMutations } = await import(
      '@/composables/file-tree-view/mutations'
    )
    const state = buildState()
    state.deleteTarget.value = { path: 'src', isDirectory: true }
    const mutations = createFileTreeMutations(state)

    await mutations.handleDeleteConfirm()

    expect(fsDelete).toHaveBeenCalledWith({
      projectRoot: '/tmp/proj',
      path: 'src',
      recursive: true,
    })
    expect(state.refresh).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('Folder deleted')
    expect(state.deleteTarget.value).toBeNull()
    expect(state.deleting.value).toBe(false)
  })

  it('deletes a file with recursive false and toasts File deleted', async () => {
    const { createFileTreeMutations } = await import(
      '@/composables/file-tree-view/mutations'
    )
    const state = buildState()
    state.deleteTarget.value = { path: 'src/main.ts', isDirectory: false }
    const mutations = createFileTreeMutations(state)

    await mutations.handleDeleteConfirm()

    expect(fsDelete).toHaveBeenCalledWith({
      projectRoot: '/tmp/proj',
      path: 'src/main.ts',
      recursive: false,
    })
    expect(toast.success).toHaveBeenCalledWith('File deleted')
  })

  it('keeps the delete snapshot when the dialog closes while delete is in flight', async () => {
    const { createFileTreeMutations } = await import(
      '@/composables/file-tree-view/mutations'
    )
    let resolveDelete!: () => void
    fsDelete.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = () => resolve()
        }),
    )

    const state = buildState()
    state.deleteTarget.value = { path: 'src/gone.ts', isDirectory: false }
    const mutations = createFileTreeMutations(state)

    const confirmPromise = mutations.handleDeleteConfirm()
    expect(state.deleting.value).toBe(true)

    mutations.handleDeleteOpenChange(false)
    expect(state.deleteTarget.value).toEqual({
      path: 'src/gone.ts',
      isDirectory: false,
    })

    resolveDelete()
    await confirmPromise

    expect(fsDelete).toHaveBeenCalledWith({
      projectRoot: '/tmp/proj',
      path: 'src/gone.ts',
      recursive: false,
    })
    expect(toast.success).toHaveBeenCalledWith('File deleted')
  })

  it('clears deleteTarget when the dialog closes and delete is not in flight', async () => {
    const { createFileTreeMutations } = await import(
      '@/composables/file-tree-view/mutations'
    )
    const state = buildState()
    state.deleteTarget.value = { path: 'src/main.ts', isDirectory: false }
    state.deleting.value = false
    const mutations = createFileTreeMutations(state)

    mutations.handleDeleteOpenChange(false)

    expect(state.deleteTarget.value).toBeNull()
  })

  it('does not clear deleteTarget when the dialog closes while deleting', async () => {
    const { createFileTreeMutations } = await import(
      '@/composables/file-tree-view/mutations'
    )
    const state = buildState()
    state.deleteTarget.value = { path: 'src/main.ts', isDirectory: false }
    state.deleting.value = true
    const mutations = createFileTreeMutations(state)

    mutations.handleDeleteOpenChange(false)

    expect(state.deleteTarget.value).toEqual({
      path: 'src/main.ts',
      isDirectory: false,
    })
  })

  it('toasts an error and skips fsDelete when project root is missing', async () => {
    const { createFileTreeMutations } = await import(
      '@/composables/file-tree-view/mutations'
    )
    const state = buildState({
      projectRoot: computed(() => null),
    })
    state.deleteTarget.value = { path: 'src/main.ts', isDirectory: false }
    const mutations = createFileTreeMutations(state)

    await mutations.handleDeleteConfirm()

    expect(fsDelete).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Project root is unavailable')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('toasts an error when confirm runs without a delete target', async () => {
    const { createFileTreeMutations } = await import(
      '@/composables/file-tree-view/mutations'
    )
    const state = buildState()
    const mutations = createFileTreeMutations(state)

    await mutations.handleDeleteConfirm()

    expect(fsDelete).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Failed to delete', {
      description: 'Nothing was selected to delete',
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('stops CodeGraph before deleting .codegraph', async () => {
    const { createFileTreeMutations } = await import(
      '@/composables/file-tree-view/mutations'
    )
    const state = buildState()
    state.deleteTarget.value = { path: '.codegraph', isDirectory: true }
    const mutations = createFileTreeMutations(state)

    await mutations.handleDeleteConfirm()

    expect(mcpStop).toHaveBeenCalledWith('codegraph')
    expect(fsDelete).toHaveBeenCalledWith({
      projectRoot: '/tmp/proj',
      path: '.codegraph',
      recursive: true,
    })
    expect(mcpStop.mock.invocationCallOrder[0]).toBeLessThan(
      fsDelete.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
    expect(toast.success).toHaveBeenCalledWith('Folder deleted')
  })

  it('toasts Failed to delete and does not claim success when fsDelete rejects', async () => {
    const { createFileTreeMutations } = await import(
      '@/composables/file-tree-view/mutations'
    )
    fsDelete.mockRejectedValueOnce(new Error('permission denied'))
    const state = buildState()
    state.deleteTarget.value = { path: 'src/main.ts', isDirectory: false }
    const mutations = createFileTreeMutations(state)

    await mutations.handleDeleteConfirm()

    expect(toast.error).toHaveBeenCalledWith('Failed to delete', {
      description: 'permission denied',
    })
    expect(toast.success).not.toHaveBeenCalled()
    expect(state.deleting.value).toBe(false)
  })
})
