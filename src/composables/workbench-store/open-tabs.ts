import type {
  AgentShellPayload,
  ChangesPayload,
  EditorPayload,
  PlanPayload,
  StudioPayload,
  TerminalPayload,
  WorkbenchTab,
} from '@/types/workbench/workbench-tab'
import { isHomeChatSlug } from '@/constants/home-chat'
import toProjectRelativePath from '@/utils/to-project-relative-path'
import { addEditorFile } from './editor'
import { resolveWorkbenchTabOpen } from './duplicate-dialog'
import {
  createId,
  ensureHomeRoot,
  findTab,
  focusTab,
  getProject,
  updateTab,
} from './helpers'
import { tabs } from './state'

export const openEditor = async (projectId: string, path = ''): Promise<void> => {
  if (isHomeChatSlug(projectId)) {
    await ensureHomeRoot()
  }

  const project = getProject(projectId)
  const editorPath =
    path && project?.rootPath ? toProjectRelativePath(path, project.rootPath) : path

  const predicate = (tab: WorkbenchTab) =>
    tab.type === 'editor' && tab.projectId === projectId
  const existing = findTab(predicate)

  if (existing) {
    if (editorPath) {
      addEditorFile(existing.id, editorPath, false)
    }
    focusTab(existing.id)
    return
  }

  const openPaths = editorPath ? [editorPath] : []
  const fileName = editorPath ? (editorPath.split('/').pop() ?? editorPath) : 'Editor'
  const tab: WorkbenchTab = {
    id: createId(),
    type: 'editor',
    projectId,
    label: fileName,
    payload: { path: editorPath || '', openPaths } satisfies EditorPayload,
  }
  tabs.value.push(tab)
  focusTab(tab.id)
}

export const openDiff = async (projectId: string, path: string): Promise<void> => {
  if (!path) {
    return
  }

  if (isHomeChatSlug(projectId)) {
    await ensureHomeRoot()
  }

  const predicate = (tab: WorkbenchTab) =>
    tab.type === 'editor' && tab.projectId === projectId
  const existing = findTab(predicate)

  if (existing) {
    addEditorFile(existing.id, path, true)
    focusTab(existing.id)
    return
  }

  const tab: WorkbenchTab = {
    id: createId(),
    type: 'editor',
    projectId,
    label: path.split('/').pop() ?? path,
    payload: { path, openPaths: [path], diffView: true } satisfies EditorPayload,
  }
  tabs.value.push(tab)
  focusTab(tab.id)
}

export const openTerminal = async (
  projectId: string,
  label?: string,
  cwd?: string,
): Promise<void> => {
  if (isHomeChatSlug(projectId)) {
    await ensureHomeRoot()
  }

  const predicate = (tab: WorkbenchTab) =>
    tab.type === 'terminal' && tab.projectId === projectId
  const existing = findTab(predicate)

  if (existing) {
    const resolution = await resolveWorkbenchTabOpen({
      projectId,
      type: 'terminal',
      predicate,
    })
    if (resolution === 'existing') {
      focusTab(existing.id)
      return
    }
  }

  const project = getProject(projectId)
  const tabLabel =
    label ?? (isHomeChatSlug(projectId) ? 'Home' : project?.slug ?? 'Terminal')
  const tab: WorkbenchTab = {
    id: createId(),
    type: 'terminal',
    projectId,
    label: tabLabel,
    payload: { sessionId: null, cwd: cwd ?? null } satisfies TerminalPayload,
  }
  tabs.value.push(tab)
  focusTab(tab.id)
}

export const openPlan = (
  projectId: string,
  planId: string,
  path: string,
  label?: string,
): void => {
  const existing = findTab(
    (tab) => tab.type === 'plan' && (tab.payload as PlanPayload).planId === planId,
  )
  if (existing) {
    focusTab(existing.id)
    return
  }

  const tab: WorkbenchTab = {
    id: createId(),
    type: 'plan',
    projectId,
    label: label ?? planId,
    payload: { planId, path } satisfies PlanPayload,
  }
  tabs.value.push(tab)
  focusTab(tab.id)
}

export const openStudio = (
  projectId: string,
  artifactSlug: string,
  path: string,
  label?: string,
): void => {
  const existing = findTab(
    (tab) =>
      tab.type === 'studio' &&
      (tab.payload as StudioPayload).artifactSlug === artifactSlug,
  )
  if (existing) {
    updateTab(existing.id, {
      label: label ?? artifactSlug,
      payload: { artifactSlug, path } satisfies StudioPayload,
    })
    focusTab(existing.id)
    return
  }

  const tab: WorkbenchTab = {
    id: createId(),
    type: 'studio',
    projectId,
    label: label ?? artifactSlug,
    payload: { artifactSlug, path } satisfies StudioPayload,
  }
  tabs.value.push(tab)
  focusTab(tab.id)
}

export const openAgentShell = (
  projectId: string,
  shellId: string,
  label?: string,
): void => {
  const existing = findTab(
    (tab) =>
      tab.type === 'agent-shell' &&
      (tab.payload as AgentShellPayload).shellId === shellId,
  )
  if (existing) {
    focusTab(existing.id)
    return
  }

  const tab: WorkbenchTab = {
    id: createId(),
    type: 'agent-shell',
    projectId,
    label: label ?? 'Agent shell',
    payload: { shellId } satisfies AgentShellPayload,
  }
  tabs.value.push(tab)
  focusTab(tab.id)
}

export const openChanges = async (projectId: string): Promise<void> => {
  const predicate = (tab: WorkbenchTab) =>
    tab.type === 'changes' && tab.projectId === projectId
  const existing = findTab(predicate)

  if (existing) {
    const resolution = await resolveWorkbenchTabOpen({
      projectId,
      type: 'changes',
      predicate,
    })
    if (resolution === 'existing') {
      focusTab(existing.id)
      return
    }
  }

  const tab: WorkbenchTab = {
    id: createId(),
    type: 'changes',
    projectId,
    label: 'Changes',
    payload: {} satisfies ChangesPayload,
  }
  tabs.value.push(tab)
  focusTab(tab.id)
}
