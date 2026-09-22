import { beforeEach, describe, expect, it } from 'vitest'
import {
  assertCreatePlanNotAwaitingPlanGo,
  clearAwaitingPlanGo,
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
      `Plan awaiting user Go (${planPath}). Wait for Build / Orchestrate, or call update_plan to revise the body, update_plan_todo for todos. Do not create another plan.`,
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
      `Plan awaiting user Go (${planPath}). Wait for Build / Orchestrate, or call update_plan to revise the body, update_plan_todo for todos. Do not create another plan.`,
    )
  })
})

describe('resolvePlanPath', () => {
  beforeEach(() => {
    dropPlanExecutionSession(projectSlug, chatId)
  })

  it('resolves to the active awaiting plan when planPath is omitted', () => {
    const planPath = '.vixl/plans/active/PLAN.md'
    markCreatedPlanThisTurn(projectSlug, chatId, {
      planPath,
      planId: 'active',
    })
    const session = getPlanExecutionSession(projectSlug, chatId)

    expect(resolvePlanPath(undefined, session.awaitingPlanGo)).toBe(planPath)
  })

  it('prefers an explicit planPath over awaitingPlanGo and activePlanPath', () => {
    markCreatedPlanThisTurn(projectSlug, chatId, {
      planPath: '.vixl/plans/awaiting/PLAN.md',
      planId: 'awaiting',
    })
    const session = getPlanExecutionSession(projectSlug, chatId)
    const explicit = '.vixl/plans/explicit/PLAN.md'
    const active = '.vixl/plans/active/PLAN.md'

    expect(resolvePlanPath(explicit, session.awaitingPlanGo, active)).toBe(explicit)
  })

  it('prefers awaitingPlanGo over activePlanPath when planPath is omitted', () => {
    markCreatedPlanThisTurn(projectSlug, chatId, {
      planPath: '.vixl/plans/awaiting/PLAN.md',
      planId: 'awaiting',
    })
    const session = getPlanExecutionSession(projectSlug, chatId)
    const active = '.vixl/plans/bound/PLAN.md'

    expect(resolvePlanPath(undefined, session.awaitingPlanGo, active)).toBe(
      '.vixl/plans/awaiting/PLAN.md',
    )
  })

  it('resolves to activePlanPath when planPath and awaitingPlanGo are absent', () => {
    const session = getPlanExecutionSession(projectSlug, chatId)
    const active = '.vixl/plans/bound/PLAN.md'

    expect(resolvePlanPath(undefined, session.awaitingPlanGo, active)).toBe(active)
  })

  it('returns null when planPath, awaitingPlanGo, and activePlanPath are absent', () => {
    const session = getPlanExecutionSession(projectSlug, chatId)

    expect(
      resolvePlanPath(undefined, session.awaitingPlanGo, session.activePlanPath),
    ).toBeNull()
  })
})

describe('resolveUpdatePlanTodoPath', () => {
  beforeEach(() => {
    dropPlanExecutionSession(projectSlug, chatId)
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

  it('prefers an explicit planPath over awaitingPlanGo and activePlanPath', () => {
    markCreatedPlanThisTurn(projectSlug, chatId, {
      planPath: '.vixl/plans/awaiting/PLAN.md',
      planId: 'awaiting',
    })
    const session = getPlanExecutionSession(projectSlug, chatId)
    const explicit = '.vixl/plans/explicit/PLAN.md'
    const active = '.vixl/plans/active/PLAN.md'

    expect(
      resolveUpdatePlanTodoPath(explicit, session.awaitingPlanGo, active),
    ).toBe(explicit)
  })

  it('prefers awaitingPlanGo over activePlanPath when planPath is omitted', () => {
    markCreatedPlanThisTurn(projectSlug, chatId, {
      planPath: '.vixl/plans/awaiting/PLAN.md',
      planId: 'awaiting',
    })
    const session = getPlanExecutionSession(projectSlug, chatId)
    const active = '.vixl/plans/bound/PLAN.md'

    expect(
      resolveUpdatePlanTodoPath(undefined, session.awaitingPlanGo, active),
    ).toBe('.vixl/plans/awaiting/PLAN.md')
  })

  it('resolves to activePlanPath when planPath and awaitingPlanGo are absent', () => {
    const session = getPlanExecutionSession(projectSlug, chatId)
    const active = '.vixl/plans/bound/PLAN.md'

    expect(resolveUpdatePlanTodoPath(undefined, session.awaitingPlanGo, active)).toBe(
      active,
    )
  })

  it('returns null when planPath, awaitingPlanGo, and activePlanPath are absent', () => {
    const session = getPlanExecutionSession(projectSlug, chatId)

    expect(
      resolveUpdatePlanTodoPath(undefined, session.awaitingPlanGo, session.activePlanPath),
    ).toBeNull()
  })

  it('returns null when no plan is active and planPath is omitted', () => {
    const session = getPlanExecutionSession(projectSlug, chatId)

    expect(resolveUpdatePlanTodoPath(undefined, session.awaitingPlanGo)).toBeNull()
  })

  it('is an alias of resolvePlanPath', () => {
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
      awaitingPlanGo: { planPath: '.vixl/plans/awaiting/PLAN.md', planId: 'awaiting' },
    })

    const session = getPlanExecutionSession(projectSlug, chatId)
    expect(session.activePlanPath).toBe('.vixl/plans/bound/PLAN.md')
    expect(session.awaitingPlanGo?.planPath).toBe('.vixl/plans/awaiting/PLAN.md')
  })
})
