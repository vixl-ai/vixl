import type {
  WorkbenchTabPayload,
  WorkbenchTabType,
} from './workbench-tab'

export type WorkbenchSessionTab = {
  id: string
  type: WorkbenchTabType
  projectId: string
  label: string
  payload: WorkbenchTabPayload
}

export type WorkbenchSession = {
  tabs: WorkbenchSessionTab[]
  rightSidebarOpen?: boolean
  activeTabId?: string | null
}
