import { call } from './helpers'
import type {
  WorkbenchSession,
  WorkbenchSessionTab,
} from '@/types/workbench/workbench-session'

export const workbenchLoadSession = (): Promise<WorkbenchSession> =>
  call('workbench_load_session')

export const workbenchReplaceSession = (args: {
  tabs: WorkbenchSessionTab[]
  activeTabId?: string | null
  rightSidebarOpen?: boolean
}): Promise<void> => call('workbench_replace_session', args)

export const editorLoadViewState = (
  projectId: string,
  path: string,
): Promise<unknown | null> => call('editor_load_view_state', { projectId, path })

export const editorSaveViewState = (
  projectId: string,
  path: string,
  viewState: unknown,
): Promise<void> => call('editor_save_view_state', { projectId, path, viewState })
