import { beforeEach, describe, expect, it } from 'vitest'
import {
  assertCreatePlanNotAwaitingPlanGo,
  clearAwaitingPlanGo,
  getPlanExecutionSession,
  hydratePlanExecutionSession,
  markCreatedPlanThisTurn,
  resolveUpdatePlanTodoPath,
} from '@/services/harness/plan-execution-session'

const projectSlug = 'test-project'
const chatId = 'chat-plan-session'

describe('assertCreatePlanNotAwaitingPlanGo', () => {
  beforeEach(() => {
    clearAwaitingPlanGo(projectSlug, chatId)
  })

  it('throws with the named planPath when awaitingPlanGo is set', () => {
    const planPath = '.vixl/plans/example-2026-08-09/PLAN.md'
    markCreatedPlanThisTurn(projectSlug, chatId, {
      planPath,
      planId: 'example-2026-08-09',
    })

    expect(() => assertCreatePlanNotAwaitingPlanGo(projectSlug, chatId)).toThrow(
      `Plan awaiting user Go (${planPath}). Wait for Build / Orchestrate, or call update_plan_todo / update_todos. Do not create another plan.`,
    )
  })

  it('does not throw when no plan is awaiting Go', () => {
    expect(() => assertCreatePlanNotAwaitingPlanGo(projectSlug, chatId)).not.toThrow()
  })

  it('throws after hydratePlanExecutionSession sets awaitingPlanGo', () => {
    const planPath = '.vixl/plans/hydrated/PLAN.md'
    hydratePlanExecutionSession(projectSlug, chatId, {
      awaitingPlanGo: { planPath, planId: 'hydrated' },
    })

    expect(() => assertCreatePlanNotAwaitingPlanGo(projectSlug, chatId)).toThrow(
      `Plan awaiting user Go (${planPath}).`,
    )
  })
})

describe('resolveUpdatePlanTodoPath', () => {
  beforeEach(() => {
    clearAwaitingPlanGo(projectSlug, chatId)
  })

  it('resolves to the active awaiting plan when planPath is omitted', () => {
    const planPath = '.vixl/plans/active/PLAN.md'
    markCreatedPlanThisTurn(projectSlug, chatId, {
      planPath,
      planId: 'active',
    })
    const session = getPlanExecutionSession(projectSlug, chatId)

    expect(resolveUpdatePlanTodoPath(undefined, session.awaitingPlanGo)).toBe(planPath)
  })

  it('prefers an explicit planPath over the awaiting plan', () => {
    markCreatedPlanThisTurn(projectSlug, chatId, {
      planPath: '.vixl/plans/awaiting/PLAN.md',
      planId: 'awaiting',
    })
    const session = getPlanExecutionSession(projectSlug, chatId)
    const explicit = '.vixl/plans/explicit/PLAN.md'

    expect(resolveUpdatePlanTodoPath(explicit, session.awaitingPlanGo)).toBe(explicit)
  })

  it('returns null when no plan is active and planPath is omitted', () => {
    const session = getPlanExecutionSession(projectSlug, chatId)

    expect(resolveUpdatePlanTodoPath(undefined, session.awaitingPlanGo)).toBeNull()
  })
})
