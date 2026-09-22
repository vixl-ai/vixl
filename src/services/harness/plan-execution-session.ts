import type { AwaitingPlanGo } from '@/types/plans/awaiting-plan-go'
import type { ReasoningLevel } from '@/types/models/reasoning-level'

export type PlanExecutionSession = {
  awaitingPlanGo: AwaitingPlanGo | null
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
    awaitingPlanGo: null,
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
    awaitingPlanGo?: AwaitingPlanGo | null
    activePlanPath?: string | null
    subagentModel?: string | null
    subagentReasoning?: ReasoningLevel | null
  },
): PlanExecutionSession => {
  const session = getPlanExecutionSession(projectSlug, chatId)
  if (patch.awaitingPlanGo !== undefined) {
    session.awaitingPlanGo = patch.awaitingPlanGo
  }
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

export const markCreatedPlanThisTurn = (
  projectSlug: string,
  chatId: string,
  awaiting: AwaitingPlanGo,
): void => {
  const session = getPlanExecutionSession(projectSlug, chatId)
  session.awaitingPlanGo = awaiting
  session.createdPlanThisTurn = true
}

export const clearAwaitingPlanGo = (
  projectSlug: string,
  chatId: string,
): void => {
  const session = getPlanExecutionSession(projectSlug, chatId)
  session.awaitingPlanGo = null
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

export const isAwaitingPlanGo = (
  projectSlug: string,
  chatId: string,
): boolean => Boolean(getPlanExecutionSession(projectSlug, chatId).awaitingPlanGo)

export const PLAN_GO_BLOCKED_TOOLS = new Set([
  'write_file',
  'edit_file',
  'apply_patch',
  'delete_file',
  'move_file',
  'run_terminal',
  'terminal_output',
  'stop_terminal',
  'git_checkout',
  'git_branch_create',
  'git_commit',
  'call_mcp_tool',
  'get_mcp_tool',
  'get_mcp_tools',
  'list_mcp_resources',
  'read_mcp_resource',
  'get_mcp_prompt',
  'spawn_subagent',
  'steer_subagent',
  'create_plan',
])

/**
 * Tools that stay in the toolset while awaiting Go so execute can throw a
 * visible error (filtering alone would hide the tool and invite retries via
 * other paths). All other PLAN_GO_BLOCKED_TOOLS are filtered out silently.
 */
export const PLAN_GO_EXECUTE_GATE_TOOLS = new Set(['create_plan'])

export const assertNotAwaitingPlanGo = (
  projectSlug: string,
  chatId: string,
): void => {
  const awaiting = getPlanExecutionSession(projectSlug, chatId).awaitingPlanGo
  if (!awaiting) {
    return
  }
  throw new Error(
    `Plan awaiting user Go. Use Build now or Orchestrate on the plan tab before making changes (${awaiting.planPath}).`,
  )
}

export const assertCreatePlanNotAwaitingPlanGo = (
  projectSlug: string,
  chatId: string,
): void => {
  const awaiting = getPlanExecutionSession(projectSlug, chatId).awaitingPlanGo
  if (!awaiting) {
    return
  }
  throw new Error(
    `Plan awaiting user Go (${awaiting.planPath}). Wait for Build / Orchestrate, or call update_plan to revise the body, update_plan_todo for todos. Do not create another plan.`,
  )
}

/**
 * Resolve planPath for plan tools: explicit path wins, then the
 * active awaiting-Go plan, then the session activePlanPath. Returns null when
 * none is available.
 */
export const resolvePlanPath = (
  planPath: string | undefined,
  awaitingPlanGo: AwaitingPlanGo | null,
  activePlanPath?: string | null,
): string | null => planPath ?? awaitingPlanGo?.planPath ?? activePlanPath ?? null

export const resolveUpdatePlanTodoPath = resolvePlanPath
