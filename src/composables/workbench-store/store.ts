import { computed, watch } from 'vue'
import { vixlFileChangeToken } from '@/composables/use-vixl-live-sync'
import {
  cancelDuplicateTabDialog,
  confirmDuplicateTabChoice,
} from './duplicate-dialog'
import {
  addEditorFile,
  closeEditorFile,
  setEditorActivePath,
  setEditorDiffView,
  setEditorTabDirty,
} from './editor'
import {
  ensureHomeRoot,
  focusTab,
  getProject,
  reloadWorkspaceFiles,
  resolveProjectIdByRoot,
  resolveProjectIdBySlug,
  resolveWorkspaceProjectId,
  setRightSidebarOpen,
  toggleRightSidebar,
} from './helpers'
import {
  openAgentShell,
  openChanges,
  openDiff,
  openEditor,
  openPlan,
  openStudio,
  openTerminal,
} from './open-tabs'
import {
  activeTabId,
  duplicateDialogOpen,
  duplicateDialogTabType,
  rightSidebarOpen,
  tabs,
  tabRefreshTokens,
  workspaceFileReloadNonce,
  workspaceFileReloadPaths,
} from './state'
import {
  closeAll,
  closeOthers,
  closeTab,
  getActiveTerminalSessionId,
  refreshPlanStudioTabs,
  registerTerminalSession,
  reorderTabs,
  unregisterTerminalSession,
  writeToActiveTerminal,
} from './tab-lifecycle'
import { startWorkbenchPersist } from './persist'

const activeTab = computed(
  () => tabs.value.find((tab) => tab.id === activeTabId.value) ?? null,
)

const hasMultipleProjects = computed(() => {
  const ids = new Set(tabs.value.map((tab) => tab.projectId))
  return ids.size > 1
})

watch(vixlFileChangeToken, () => {
  refreshPlanStudioTabs()
})

startWorkbenchPersist()

const useWorkbenchStore = () => ({
  tabs,
  activeTabId,
  activeTab,
  rightSidebarOpen,
  tabRefreshTokens,
  hasMultipleProjects,
  duplicateDialogOpen,
  duplicateDialogTabType,
  workspaceFileReloadNonce,
  workspaceFileReloadPaths,
  focusTab,
  openEditor,
  openDiff,
  openTerminal,
  openPlan,
  openStudio,
  openAgentShell,
  openChanges,
  closeTab,
  closeOthers,
  closeAll,
  reorderTabs,
  registerTerminalSession,
  reloadWorkspaceFiles,
  unregisterTerminalSession,
  getActiveTerminalSessionId,
  writeToActiveTerminal,
  refreshPlanStudioTabs,
  setRightSidebarOpen,
  toggleRightSidebar,
  getProject,
  resolveProjectIdByRoot,
  resolveProjectIdBySlug,
  resolveWorkspaceProjectId,
  ensureHomeRoot,
  confirmDuplicateTabChoice,
  cancelDuplicateTabDialog,
  addEditorFile,
  setEditorActivePath,
  setEditorDiffView,
  closeEditorFile,
  setEditorTabDirty,
})

export default useWorkbenchStore
