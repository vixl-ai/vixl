import { ref } from 'vue'
import type {
  WorkbenchTab,
  WorkbenchTabType,
} from '@/types/workbench/workbench-tab'

export type DuplicateTabResolution = 'existing' | 'new'

export type PromptableTabType = Exclude<
  WorkbenchTabType,
  'plan' | 'studio' | 'agent-shell'
>

export type ResolveWorkbenchTabOpenParams = {
  projectId: string
  type: PromptableTabType
  predicate: (tab: WorkbenchTab) => boolean
}

export const tabs = ref<WorkbenchTab[]>([])
export const activeTabId = ref<string | null>(null)
export const rightSidebarOpen = ref(false)
export const terminalSessions = new Map<string, string>()
export const tabRefreshTokens = ref<Record<string, number>>({})
export const duplicateDialogOpen = ref(false)
export const duplicateDialogTabType = ref<PromptableTabType>('editor')
export const homeRootPath = ref<string | null>(null)
export const workspaceFileReloadNonce = ref(0)
export const workspaceFileReloadPaths = ref<string[]>([])

export const duplicateDialog = {
  resolve: null as ((value: DuplicateTabResolution) => void) | null,
}

export const homeRoot = {
  promise: null as Promise<string> | null,
}
