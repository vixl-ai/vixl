import { inject, type InjectionKey, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { useFileTreeContext } from '@/components/ai-elements/file-tree/context'
import useChatPromptBridge from '@/composables/use-chat-prompt-bridge'
import useChatStore from '@/composables/use-chat-store'
import useFileTreeClipboard from '@/composables/use-file-tree-clipboard'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useVixlConfig from '@/composables/use-vixl-config'
import useWorkbenchStore from '@/composables/use-workbench-store'
import resolveModelForRole from '@/services/models/resolve-model-for-role'
import { setPendingChatMessage } from '@/services/chat/pending-message'
import {
  fsCopy,
  fsMove,
  revealInFolder,
} from '@/services/vixl/vixl-tauri'

export const FileTreeProjectRootKey: InjectionKey<Ref<string | null>> =
  Symbol('FileTreeProjectRoot')

export const FileTreeProjectIdKey: InjectionKey<Ref<string | null>> =
  Symbol('FileTreeProjectId')

export const FileTreeRefreshKey: InjectionKey<() => Promise<void>> =
  Symbol('FileTreeRefresh')

export const FileTreeStartRenameKey: InjectionKey<(path: string) => void> =
  Symbol('FileTreeStartRename')

export const FileTreeStartDeleteKey: InjectionKey<
  (path: string, isDirectory: boolean) => void
> = Symbol('FileTreeStartDelete')

const toAbsolutePath = (projectRoot: string, relativePath: string): string => {
  if (relativePath === '.' || relativePath === '') {
    return projectRoot
  }
  return `${projectRoot.replace(/\/$/, '')}/${relativePath}`
}

const parentDirectoryPath = (absolutePath: string): string => {
  const lastSlash = absolutePath.lastIndexOf('/')
  if (lastSlash <= 0) {
    return absolutePath
  }
  return absolutePath.slice(0, lastSlash)
}

const basename = (path: string): string => {
  const segments = path.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? path
}

const joinRelativePath = (directory: string, name: string): string => {
  if (directory === '.' || directory === '') {
    return name
  }
  return `${directory}/${name}`
}

const parentRelativePath = (path: string): string => {
  const segments = path.split('/').filter(Boolean)
  if (segments.length <= 1) {
    return '.'
  }
  return segments.slice(0, -1).join('/')
}

export default () => {
  const projectRoot = inject(FileTreeProjectRootKey)
  const projectId = inject(FileTreeProjectIdKey)
  const refreshTree = inject(FileTreeRefreshKey)
  const startRename = inject(FileTreeStartRenameKey)
  const startDelete = inject(FileTreeStartDeleteKey)

  if (!projectRoot) {
    throw new Error('useFileTreeNodeMenu must be used within a file tree project root provider')
  }

  const { onSelect } = useFileTreeContext()
  const clipboard = useFileTreeClipboard()
  const workbench = useWorkbenchStore()
  const fleet = useFleetRegistry()
  const chatStore = useChatStore()
  const config = useVixlConfig()
  const chatPromptBridge = useChatPromptBridge()
  const router = useRouter()

  const requireProjectRoot = (): string | null => {
    const root = projectRoot.value
    if (!root) {
      toast.error('Project root is unavailable')
      return null
    }
    return root
  }

  const requireProjectId = (): string | null => {
    const id = projectId?.value
    if (!id) {
      toast.error('Project is unavailable')
      return null
    }
    return id
  }

  const copyText = async (text: string, failureTitle: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
    } catch (error) {
      toast.error(failureTitle, {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const copyRelativePath = async (relativePath: string): Promise<void> => {
    const displayPath = relativePath === '' ? '.' : relativePath
    await copyText(displayPath, 'Failed to copy relative path')
  }

  const copyAbsolutePath = async (relativePath: string): Promise<void> => {
    const root = requireProjectRoot()
    if (!root) {
      return
    }
    await copyText(toAbsolutePath(root, relativePath), 'Failed to copy path')
  }

  const copyName = async (name: string): Promise<void> => {
    await copyText(name, 'Failed to copy name')
  }

  const revealInFinder = async (
    relativePath: string,
    isDirectory: boolean,
  ): Promise<void> => {
    const root = requireProjectRoot()
    if (!root) {
      return
    }

    const absolutePath = toAbsolutePath(root, relativePath)
    const revealPath = isDirectory ? absolutePath : parentDirectoryPath(absolutePath)

    try {
      await revealInFolder(revealPath)
    } catch (error) {
      toast.error('Failed to reveal in Finder', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const openInEditor = (relativePath: string): void => {
    onSelect(relativePath)
  }

  const handleRename = (relativePath: string): void => {
    startRename?.(relativePath)
  }

  const handleDelete = (relativePath: string, isDirectory: boolean): void => {
    if (!startDelete) {
      toast.error('Failed to delete', {
        description: 'File tree is not ready',
      })
      return
    }
    startDelete(relativePath, isDirectory)
  }

  const handleCut = (relativePath: string): void => {
    clipboard.setCut(relativePath)
  }

  const handleCopy = (relativePath: string): void => {
    clipboard.setCopy(relativePath)
  }

  const handlePaste = async (folderPath: string): Promise<void> => {
    const root = requireProjectRoot()
    if (!root || !clipboard.clipboardPath.value || !clipboard.mode.value) {
      return
    }

    const sourcePath = clipboard.clipboardPath.value
    const destinationPath = joinRelativePath(folderPath, basename(sourcePath))

    try {
      if (clipboard.mode.value === 'copy') {
        await fsCopy({
          projectRoot: root,
          from: sourcePath,
          to: destinationPath,
        })
      } else {
        await fsMove({
          projectRoot: root,
          from: sourcePath,
          to: destinationPath,
        })
        clipboard.clear()
      }
      if (refreshTree) {
        await refreshTree()
      }
    } catch (error) {
      toast.error('Failed to paste', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleAddFileToChat = (relativePath: string): void => {
    chatPromptBridge.appendMention(relativePath)
  }

  const handleAddFileToNewChat = async (relativePath: string): Promise<void> => {
    const id = requireProjectId()
    const root = requireProjectRoot()
    if (!id || !root) {
      return
    }

    const project = fleet.projects.value.find((item) => item.id === id)
    if (!project) {
      toast.error('Project not found')
      return
    }

    const mode = 'agent' as const
    const model = resolveModelForRole(mode, config.effectiveSettings.value) ?? ''
    if (!model) {
      toast.error('Select a default model in Settings before starting a chat')
      return
    }

    const mention = relativePath.startsWith('@') ? relativePath : `@${relativePath}`

    try {
      await fleet.setActiveProject(project.id)
      const chat = await chatStore.createNewChat({
        projectSlug: project.slug,
        projectRoot: project.rootPath,
        mode,
        model,
        title: basename(relativePath),
      })

      setPendingChatMessage({
        text: `${mention} `,
        mode,
        model,
      })

      await router.push(`/project/${project.slug}/chat/${chat.id}`)
    } catch (error) {
      toast.error('Failed to start chat with file', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleOpenInTerminal = async (
    relativePath: string,
    isDirectory: boolean,
  ): Promise<void> => {
    const id = requireProjectId()
    if (!id) {
      return
    }

    const cwd = isDirectory ? relativePath : parentRelativePath(relativePath)
    const label = basename(relativePath)

    try {
      await workbench.openTerminal(id, label, cwd)
    } catch (error) {
      toast.error('Failed to open terminal', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return {
    clipboard,
    copyRelativePath,
    copyAbsolutePath,
    copyName,
    revealInFinder,
    openInEditor,
    handleRename,
    handleDelete,
    handleCut,
    handleCopy,
    handlePaste,
    handleAddFileToChat,
    handleAddFileToNewChat,
    handleOpenInTerminal,
  }
}
