export type WorkbenchTabType =
  | 'changes'
  | 'editor'
  | 'terminal'
  | 'studio'
  | 'plan'
  | 'agent-shell'

export type EditorPayload = {
  path: string
  openPaths: string[]
  diffView?: boolean
}

export type TerminalPayload = {
  sessionId: string | null
  cwd?: string | null
}

export type PlanPayload = {
  planId: string
  path: string
}

export type StudioPayload = {
  artifactSlug: string
  path: string
}

export type AgentShellPayload = {
  shellId: string
}

export type ChangesPayload = Record<string, never>

export type WorkbenchTabPayload =
  | EditorPayload
  | TerminalPayload
  | PlanPayload
  | StudioPayload
  | AgentShellPayload
  | ChangesPayload

export type WorkbenchTab = {
  id: string
  type: WorkbenchTabType
  projectId: string
  label: string
  dirty?: boolean
  payload: WorkbenchTabPayload
}

export type { PlanFrontmatter, PlanTodoItem, ParsedPlan } from '@/types/plans/plan-document'
