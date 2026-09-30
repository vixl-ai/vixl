import type { ReasoningLevel } from '@/types/models/reasoning-level'

export type PlanExecutionSession = {
  activePlanPath: string | null
  subagentModel: string | null
  subagentReasoning: ReasoningLevel | null
  createdPlanThisTurn: boolean
}

const sessions = new Map<string, PlanExecutionSession>()

export const planExecutionSessionKey = (
  projectSlug: string,
  chatId: string,
): string => `${projectSlug}::${chatId}`

export const getPlanExecutionSession = (
  projectSlug: string,
  chatId: string,
): PlanExecutionSession => {
  const key = planExecutionSessionKey(projectSlug, chatId)
  const existing = sessions.get(key)
  if (existing) {
    return existing
  }

  const created: PlanExecutionSession = {
    activePlanPath: null,
    subagentModel: null,
    subagentReasoning: null,
    createdPlanThisTurn: false,
  }
  sessions.set(key, created)
  return created
}

export const hydratePlanExecutionSession = (
  projectSlug: string,
  chatId: string,
  patch: {
    activePlanPath?: string | null
    subagentModel?: string | null
    subagentReasoning?: ReasoningLevel | null
  },
): PlanExecutionSession => {
  const session = getPlanExecutionSession(projectSlug, chatId)
  if (patch.activePlanPath !== undefined) {
    session.activePlanPath = patch.activePlanPath
  }
  if (patch.subagentModel !== undefined) {
    session.subagentModel = patch.subagentModel
  }
  if (patch.subagentReasoning !== undefined) {
    session.subagentReasoning = patch.subagentReasoning
  }
  return session
}

export const beginPlanExecutionTurn = (
  projectSlug: string,
  chatId: string,
): PlanExecutionSession => {
  const session = getPlanExecutionSession(projectSlug, chatId)
  session.createdPlanThisTurn = false
  return session
}

export const markCreatedPlanThisTurn = (
  projectSlug: string,
  chatId: string,
  planPath: string,
): void => {
  const session = getPlanExecutionSession(projectSlug, chatId)
  session.activePlanPath = planPath
  session.createdPlanThisTurn = true
}

export const rekeyPlanExecutionSession = (
  fromProjectSlug: string,
  chatId: string,
  toProjectSlug: string,
): void => {
  const fromKey = planExecutionSessionKey(fromProjectSlug, chatId)
  const toKey = planExecutionSessionKey(toProjectSlug, chatId)
  if (fromKey === toKey) {
    return
  }
  const existing = sessions.get(fromKey)
  if (!existing) {
    return
  }
  sessions.delete(fromKey)
  sessions.set(toKey, existing)
}

export const dropPlanExecutionSession = (projectSlug: string, chatId: string): void => {
  sessions.delete(planExecutionSessionKey(projectSlug, chatId))
}

export const setActivePlanPath = (
  projectSlug: string,
  chatId: string,
  path: string | null,
): void => {
  const session = getPlanExecutionSession(projectSlug, chatId)
  session.activePlanPath = path
}

export const setSubagentModelLock = (
  projectSlug: string,
  chatId: string,
  model: string | null,
  reasoning?: ReasoningLevel | null,
): void => {
  const session = getPlanExecutionSession(projectSlug, chatId)
  session.subagentModel = model
  if (reasoning !== undefined) {
    session.subagentReasoning = reasoning
  }
}

/**
 * Resolve planPath for plan tools: explicit path wins, then the session
 * activePlanPath (the most recently created or built plan). Returns null when
 * neither is available.
 */
export const resolvePlanPath = (
  planPath: string | undefined,
  activePlanPath?: string | null,
): string | null => planPath ?? activePlanPath ?? null

export const resolveUpdatePlanTodoPath = resolvePlanPath
