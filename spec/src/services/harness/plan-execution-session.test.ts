import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginPlanExecutionTurn,
  dropPlanExecutionSession,
  getPlanExecutionSession,
  hydratePlanExecutionSession,
  markCreatedPlanThisTurn,
  resolvePlanPath,
  resolveUpdatePlanTodoPath,
  setActivePlanPath,
} from '@/services/harness/plan-execution-session'

const projectSlug = 'test-project'
const chatId = 'chat-plan-session'

describe('markCreatedPlanThisTurn', () => {
  beforeEach(() => {
    dropPlanExecutionSession(projectSlug, chatId)
  })

  it('makes the new plan active and flags the turn', () => {
    const planPath = '.vixl/plans/first/PLAN.md'
    markCreatedPlanThisTurn(projectSlug, chatId, planPath)

    const session = getPlanExecutionSession(projectSlug, chatId)
    expect(session.activePlanPath).toBe(planPath)
    expect(session.createdPlanThisTurn).toBe(true)
  })

  it('lets a chat create many plans, the newest becoming active', () => {
    markCreatedPlanThisTurn(projectSlug, chatId, '.vixl/plans/first/PLAN.md')
    beginPlanExecutionTurn(projectSlug, chatId)
    markCreatedPlanThisTurn(projectSlug, chatId, '.vixl/plans/second/PLAN.md')

    expect(getPlanExecutionSession(projectSlug, chatId).activePlanPath).toBe(
      '.vixl/plans/second/PLAN.md',
    )
  })

  it('beginPlanExecutionTurn resets the turn flag but keeps the active plan', () => {
    const planPath = '.vixl/plans/first/PLAN.md'
    markCreatedPlanThisTurn(projectSlug, chatId, planPath)
    beginPlanExecutionTurn(projectSlug, chatId)

    const session = getPlanExecutionSession(projectSlug, chatId)
    expect(session.createdPlanThisTurn).toBe(false)
    expect(session.activePlanPath).toBe(planPath)
  })
})

describe('resolvePlanPath', () => {
  it('prefers an explicit planPath over activePlanPath', () => {
    const explicit = '.vixl/plans/explicit/PLAN.md'
    expect(resolvePlanPath(explicit, '.vixl/plans/active/PLAN.md')).toBe(explicit)
  })

  it('resolves to activePlanPath when planPath is omitted', () => {
    const active = '.vixl/plans/active/PLAN.md'
    expect(resolvePlanPath(undefined, active)).toBe(active)
  })

  it('returns null when planPath and activePlanPath are absent', () => {
    expect(resolvePlanPath(undefined, null)).toBeNull()
    expect(resolvePlanPath(undefined)).toBeNull()
  })

  it('resolveUpdatePlanTodoPath is an alias of resolvePlanPath', () => {
    expect(resolveUpdatePlanTodoPath).toBe(resolvePlanPath)
  })
})

describe('setActivePlanPath and hydrate', () => {
  beforeEach(() => {
    dropPlanExecutionSession(projectSlug, chatId)
  })

  it('setActivePlanPath stores the path on the session', () => {
    const planPath = '.vixl/plans/bound/PLAN.md'
    setActivePlanPath(projectSlug, chatId, planPath)

    expect(getPlanExecutionSession(projectSlug, chatId).activePlanPath).toBe(planPath)
  })

  it('setActivePlanPath can clear the bound path', () => {
    setActivePlanPath(projectSlug, chatId, '.vixl/plans/bound/PLAN.md')
    setActivePlanPath(projectSlug, chatId, null)

    expect(getPlanExecutionSession(projectSlug, chatId).activePlanPath).toBeNull()
  })

  it('hydratePlanExecutionSession sets activePlanPath when provided', () => {
    const planPath = '.vixl/plans/hydrated/PLAN.md'
    hydratePlanExecutionSession(projectSlug, chatId, {
      activePlanPath: planPath,
    })

    expect(getPlanExecutionSession(projectSlug, chatId).activePlanPath).toBe(planPath)
  })

  it('hydratePlanExecutionSession leaves activePlanPath unchanged when omitted', () => {
    setActivePlanPath(projectSlug, chatId, '.vixl/plans/bound/PLAN.md')
    hydratePlanExecutionSession(projectSlug, chatId, {
      subagentModel: 'openai::gpt-4o',
    })

    const session = getPlanExecutionSession(projectSlug, chatId)
    expect(session.activePlanPath).toBe('.vixl/plans/bound/PLAN.md')
    expect(session.subagentModel).toBe('openai::gpt-4o')
  })
})
