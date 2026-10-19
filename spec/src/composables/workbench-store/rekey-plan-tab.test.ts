import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PlanPayload, WorkbenchTab } from '@/types/workbench/workbench-tab'

describe('rekeyPlanTab', () => {
  beforeEach(async () => {
    const { tabs, activeTabId } = await import('@/composables/workbench-store/state')
    tabs.value = []
    activeTabId.value = null
  })

  afterEach(async () => {
    const { tabs, activeTabId } = await import('@/composables/workbench-store/state')
    tabs.value = []
    activeTabId.value = null
  })

  it('moves an open plan tab to the new project', async () => {
    const { tabs } = await import('@/composables/workbench-store/state')
    const { rekeyPlanTab } = await import('@/composables/workbench-store/rekey-plan-tab')

    const tab: WorkbenchTab = {
      id: 'tab-1',
      type: 'plan',
      projectId: 'old-proj',
      label: 'Ship it',
      payload: {
        planId: 'ship-it',
        path: '.vixl/plans/ship-it/PLAN.md',
      } satisfies PlanPayload,
    }
    tabs.value = [tab]

    rekeyPlanTab('new-proj', 'ship-it')

    expect(tabs.value).toHaveLength(1)
    expect(tabs.value[0]?.id).toBe('tab-1')
    expect(tabs.value[0]?.projectId).toBe('new-proj')
    expect(tabs.value[0]?.payload).toEqual({
      planId: 'ship-it',
      path: '.vixl/plans/ship-it/PLAN.md',
    })
  })

  it('does nothing when no matching plan tab is open', async () => {
    const { tabs } = await import('@/composables/workbench-store/state')
    const { rekeyPlanTab } = await import('@/composables/workbench-store/rekey-plan-tab')

    const tab: WorkbenchTab = {
      id: 'tab-1',
      type: 'plan',
      projectId: 'old-proj',
      label: 'Other',
      payload: {
        planId: 'other-plan',
        path: '.vixl/plans/other-plan/PLAN.md',
      } satisfies PlanPayload,
    }
    tabs.value = [tab]

    rekeyPlanTab('new-proj', 'ship-it')

    expect(tabs.value[0]?.projectId).toBe('old-proj')
  })
})
