import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import {
  fsListDir,
  fsListDirTree,
} from '@/services/vixl/vixl-tauri'
import useWorkbenchStore from '@/composables/use-workbench-store'
import { isHomeChatSlug } from '@/constants/home-chat'
import {
  FileTreeProjectIdKey,
  FileTreeProjectRootKey,
  FileTreeRefreshKey,
  FileTreeStartDeleteKey,
  FileTreeStartRenameKey,
} from '@/composables/use-file-tree-node-menu'
import useGitStatus, {
  FileTreeGitDecorationKey,
} from '@/composables/use-git-status'
import {
  type TreeNode,
  findNode,
  findNodeKind,
  ancestorDirectoryPaths,
  treeErrorMessage,
  parentPath,
  joinPath,
} from './path-helpers'
import { createFileTreeMutations } from './mutations'
import refreshExpandedChildren from './refresh-expanded-children'

export default (
  props: { projectId: string; selectedPath?: string | null },
  emit: {
    (event: 'select', path: string): void
    (event: 'tree-changed'): void
  },
) => {
  const workbench = useWorkbenchStore()
  const tree = ref<TreeNode | null>(null)
  const expandedPaths = ref(new Set<string>(['.']))
  const selectedPath = ref(props.selectedPath ?? '')
  const renamingPath = ref<string | null>(null)
  const deleteTarget = ref<{ path: string; isDirectory: boolean } | null>(null)
  const deleting = ref(false)
  const refreshing = ref(false)
  const createDialogOpen = ref(false)
  const createDialogMode = ref<'file' | 'folder'>('file')
  const createName = ref('')
  const creating = ref(false)

  const projectLabel = computed(() => {
    const project = workbench.getProject(props.projectId)
    if (!project) {
      return 'Project'
    }
    if (isHomeChatSlug(project.id)) {
      return 'Home'
    }
    return project.name
  })

  const projectRoot = computed(
    () => workbench.getProject(props.projectId)?.rootPath ?? null,
  )

  const projectIdRef = computed(() => props.projectId)

  const gitStatus = useGitStatus(projectRoot)

  provide(FileTreeProjectRootKey, projectRoot)
  provide(FileTreeProjectIdKey, projectIdRef)
  provide(FileTreeGitDecorationKey, {
    byPath: gitStatus.byPath,
    folderByPath: gitStatus.folderByPath,
    ignoredRoots: gitStatus.ignoredRoots,
  })

  const loadTree = async (): Promise<void> => {
    const root = projectRoot.value
    if (!root) {
      tree.value = null
      return
    }
    // Home is huge and has many unreadable system dirs; keep the initial walk shallow.
    const maxDepth = isHomeChatSlug(props.projectId) ? 2 : 4
    tree.value = (await fsListDirTree(root, '.', maxDepth)) as TreeNode
    const path = props.selectedPath
    if (!path) {
      return
    }
    selectedPath.value = path
    try {
      await revealPath(path)
    } catch (error) {
      if (error instanceof Error && error.message.includes('__vnode')) {
        return
      }
      toast.error('Failed to reveal file in tree', {
        description: treeErrorMessage(error),
      })
    }
  }

  const ensureChildrenLoaded = async (directoryPath: string): Promise<void> => {
    const root = projectRoot.value
    const currentTree = tree.value
    if (!root || !currentTree) {
      return
    }

    const node =
      directoryPath === '.' || directoryPath === ''
        ? currentTree
        : findNode(currentTree.children, directoryPath)

    if (!node || node.kind !== 'directory') {
      return
    }
    if (node.children !== undefined) {
      return
    }

    const entries = await fsListDir(root, directoryPath)
    node.children = entries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      kind: entry.kind,
    }))
  }

  const scrollPathIntoView = async (path: string): Promise<void> => {
    await nextTick()
    const escaped = CSS.escape(path)
    let element = document.querySelector(`[data-path="${escaped}"]`)
    if (!(element instanceof HTMLElement)) {
      await nextTick()
      element = document.querySelector(`[data-path="${escaped}"]`)
    }
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: 'nearest' })
    }
  }

  const revealPath = async (path: string): Promise<void> => {
    if (!path || !tree.value) {
      return
    }

    const ancestors = ancestorDirectoryPaths(path)
    for (const directoryPath of ancestors) {
      await ensureChildrenLoaded(directoryPath)
    }

    const nextExpanded = new Set(expandedPaths.value)
    for (const directoryPath of ancestors) {
      nextExpanded.add(directoryPath)
    }
    expandedPaths.value = nextExpanded

    try {
      await scrollPathIntoView(path)
    } catch (error) {
      // Tree expand can race with teleported menus unmounting; scroll is best-effort.
      if (error instanceof Error && error.message.includes('__vnode')) {
        return
      }
      throw error
    }
  }

  const refresh = async (): Promise<void> => {
    refreshing.value = true
    try {
      await loadTree()
      await refreshExpandedChildren(tree, expandedPaths, ensureChildrenLoaded)
      await gitStatus.refresh()
      emit('tree-changed')
    } catch (error) {
      toast.error('Failed to refresh file tree', {
        description: treeErrorMessage(error),
      })
    } finally {
      refreshing.value = false
    }
  }

  provide(FileTreeRefreshKey, refresh)

  const startRename = (path: string): void => {
    renamingPath.value = path
  }

  const startDelete = (path: string, isDirectory: boolean): void => {
    deleteTarget.value = { path, isDirectory }
  }

  provide(FileTreeStartRenameKey, startRename)
  provide(FileTreeStartDeleteKey, startDelete)



  const mutations = createFileTreeMutations({
    props,
    emit,
    tree,
    expandedPaths,
    selectedPath,
    renamingPath,
    deleteTarget,
    deleting,
    createDialogOpen,
    createDialogMode,
    createName,
    creating,
    projectRoot,
    refresh,
    ensureChildrenLoaded,
  })
  const {
    handleRenameConfirm,
    handleRenameCancel,
    handleDeleteConfirm,
    handleDeleteOpenChange,
    createParentPath,
    handleCreateDialogOpenChange,
    handleNewFile,
    handleNewFolder,
    handleCreateConfirm,
    handleRefresh,
    handleSelect,
    handleExpandedChange,
    handlePointerDownOutsideRename,
  } = mutations

  onMounted(() => {
    document.addEventListener('pointerdown', handlePointerDownOutsideRename)
    loadTree()
      .then(() => gitStatus.refresh())
      .catch((error) => {
        toast.error('Failed to load file tree', {
          description: treeErrorMessage(error),
        })
      })
  })

  onUnmounted(() => {
    document.removeEventListener('pointerdown', handlePointerDownOutsideRename)
  })

  watch(
    projectRoot,
    () => {
      loadTree()
        .then(() => gitStatus.refresh())
        .catch((error) => {
          toast.error('Failed to load file tree', {
            description: treeErrorMessage(error),
          })
        })
    },
  )

  watch(
    () => props.selectedPath,
    (path) => {
      if (!path) {
        return
      }
      selectedPath.value = path
      // Defer reveal so teleported menus (LSP status, etc.) can finish unmounting
      // before the tree expands and re-renders the toolbar slot.
      nextTick(() => {
        revealPath(path).catch((error) => {
          if (error instanceof Error && error.message.includes('__vnode')) {
            return
          }
          toast.error('Failed to reveal file in tree', {
            description: treeErrorMessage(error),
          })
        })
      })
    },
  )

  return {
    workbench,
    tree,
    expandedPaths,
    selectedPath,
    renamingPath,
    deleteTarget,
    deleting,
    refreshing,
    createDialogOpen,
    createDialogMode,
    createName,
    creating,
    projectLabel,
    projectRoot,
    projectIdRef,
    gitStatus,
    findNode,
    findNodeKind,
    ancestorDirectoryPaths,
    treeErrorMessage,
    loadTree,
    ensureChildrenLoaded,
    scrollPathIntoView,
    revealPath,
    refresh,
    startRename,
    startDelete,
    parentPath,
    joinPath,
    handleRenameConfirm,
    handleRenameCancel,
    handleDeleteConfirm,
    handleDeleteOpenChange,
    createParentPath,
    handleCreateDialogOpenChange,
    handleNewFile,
    handleNewFolder,
    handleCreateConfirm,
    handleRefresh,
    handleSelect,
    handleExpandedChange,
    handlePointerDownOutsideRename,
  }
}
