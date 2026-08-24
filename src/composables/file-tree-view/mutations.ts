import { computed, type ComputedRef, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import {
  fsDelete,
  fsMkdir,
  fsRename,
  fsWriteFile,
} from '@/services/vixl/vixl-tauri'
import {
  CODEGRAPH_DIR_NAME,
  CODEGRAPH_SERVER_ID,
} from '@/types/codegraph/managed-codegraph'
import {
  findNodeKind,
  joinPath,
  parentPath,
  treeErrorMessage,
  type TreeNode,
} from './path-helpers'

const isCodegraphWorkspacePath = (path: string): boolean =>
  path === CODEGRAPH_DIR_NAME || path.startsWith(`${CODEGRAPH_DIR_NAME}/`)

export type FileTreeMutationState = {
  props: { projectId: string; selectedPath?: string | null }
  emit: (event: 'select', path: string) => void
  tree: Ref<TreeNode | null>
  expandedPaths: Ref<Set<string>>
  selectedPath: Ref<string>
  renamingPath: Ref<string | null>
  deleteTarget: Ref<{ path: string; isDirectory: boolean } | null>
  deleting: Ref<boolean>
  createDialogOpen: Ref<boolean>
  createDialogMode: Ref<'file' | 'folder'>
  createName: Ref<string>
  creating: Ref<boolean>
  projectRoot: ComputedRef<string | null>
  refresh: () => Promise<void>
  ensureChildrenLoaded: (directoryPath: string) => Promise<void>
}

export const createFileTreeMutations = (s: FileTreeMutationState) => {
  const handleRenameConfirm = async (path: string, nextName: string): Promise<void> => {
    const root = s.projectRoot.value
    if (!root) {
      toast.error('Project root is unavailable')
      return
    }

    const trimmed = nextName.trim()
    if (!trimmed || trimmed === path.split('/').pop()) {
      s.renamingPath.value = null
      return
    }

    const destination = joinPath(parentPath(path), trimmed)

    try {
      await fsRename({ projectRoot: root,
        from: path,
        to: destination,
      })
      s.renamingPath.value = null
      await s.refresh()
    } catch (error) {
      toast.error('Failed to rename', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleRenameCancel = (): void => {
    s.renamingPath.value = null
  }

  const handleDeleteConfirm = async (): Promise<void> => {
    const root = s.projectRoot.value
    const target = s.deleteTarget.value
    const snapshot = target
      ? { path: target.path, isDirectory: target.isDirectory }
      : null

    if (!root) {
      toast.error('Project root is unavailable')
      return
    }
    if (!snapshot) {
      toast.error('Failed to delete', {
        description: 'Nothing was selected to delete',
      })
      return
    }

    s.deleting.value = true
    try {
      if (isCodegraphWorkspacePath(snapshot.path)) {
        await mcpRuntime.stop(CODEGRAPH_SERVER_ID)
      }
      await fsDelete({
        projectRoot: root,
        path: snapshot.path,
        recursive: snapshot.isDirectory,
      })
      await s.refresh()
      s.deleteTarget.value = null
      toast.success(snapshot.isDirectory ? 'Folder deleted' : 'File deleted')
    } catch (error) {
      toast.error('Failed to delete', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      s.deleting.value = false
    }
  }

  const handleDeleteOpenChange = (open: boolean): void => {
    if (!open && !s.deleting.value) {
      s.deleteTarget.value = null
    }
  }

  const createParentPath = computed((): string => {
    const path = s.selectedPath.value
    if (!path) {
      return '.'
    }
    const kind = findNodeKind(s.tree.value?.children, path)
    if (kind === 'directory') {
      return path
    }
    return parentPath(path)
  })

  const handleCreateDialogOpenChange = (open: boolean): void => {
    s.createDialogOpen.value = open
    if (!open) {
      s.createName.value = ''
      s.creating.value = false
    }
  }

  const handleNewFile = (): void => {
    s.createDialogMode.value = 'file'
    s.createName.value = ''
    s.createDialogOpen.value = true
  }

  const handleNewFolder = (): void => {
    s.createDialogMode.value = 'folder'
    s.createName.value = ''
    s.createDialogOpen.value = true
  }

  const handleCreateConfirm = async (): Promise<void> => {
    const root = s.projectRoot.value
    const name = s.createName.value.trim()
    if (!root) {
      toast.error('Project root is unavailable')
      return
    }
    if (!name) {
      return
    }

    const destination = joinPath(createParentPath.value, name)
    const mode = s.createDialogMode.value
    s.creating.value = true
    try {
      if (mode === 'folder') {
        await fsMkdir({ projectRoot: root, path: destination })
      } else {
        await fsWriteFile({ projectRoot: root, path: destination, content: '' })
      }
      s.createDialogOpen.value = false
      s.createName.value = ''
      await s.refresh()
      if (mode === 'file') {
        s.emit('select', destination)
      }
    } catch (error) {
      toast.error(
        mode === 'folder' ? 'Failed to create folder' : 'Failed to create file',
        {
          description: error instanceof Error ? error.message : 'Unknown error',
        },
      )
    } finally {
      s.creating.value = false
    }
  }

  const handleRefresh = async (): Promise<void> => {
    await s.refresh()
  }

  const handleSelect = (path: string): void => {
    if (s.renamingPath.value) {
      handleRenameCancel()
    }
    if (findNodeKind(s.tree.value?.children, path) === 'directory') {
      return
    }
    s.selectedPath.value = path
    s.emit('select', path)
  }

  const handleExpandedChange = (expanded: Set<string>): void => {
    s.expandedPaths.value = expanded
    for (const path of expanded) {
      s.ensureChildrenLoaded(path).catch((error) => {
        toast.error('Failed to load folder', {
          description: treeErrorMessage(error),
        })
      })
    }
  }

  const handlePointerDownOutsideRename = (event: PointerEvent): void => {
    if (!s.renamingPath.value) {
      return
    }
    const target = event.target
    if (target instanceof Element && target.closest('[data-rename-input]')) {
      return
    }
    handleRenameCancel()
  }


  return {
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
