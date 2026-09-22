import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOME_WORKSPACE_ID } from '@/constants/home-chat'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const getUserHomeDir = vi.hoisted(() =>
  vi.fn<() => Promise<string>>().mockResolvedValue('/Users/test-home'),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    getUserHomeDir,
  }),
)

describe('openPlan home workspace', () => {
  beforeEach(async () => {
    getUserHomeDir.mockClear()
    getUserHomeDir.mockResolvedValue('/Users/test-home')
    const { tabs, activeTabId, homeRootPath, homeRoot } = await import(
      '@/composables/workbench-store/state'
    )
    tabs.value = []
    activeTabId.value = null
    homeRootPath.value = null
    homeRoot.promise = null
  })

  afterEach(async () => {
    const { tabs, activeTabId, homeRootPath, homeRoot } = await import(
      '@/composables/workbench-store/state'
    )
    tabs.value = []
    activeTabId.value = null
    homeRootPath.value = null
    homeRoot.promise = null
  })

  it('warms the home root before opening a HOME_WORKSPACE_ID plan tab', async () => {
    const { openPlan } = await import('@/composables/workbench-store/open-tabs')
    const { tabs, homeRootPath } = await import('@/composables/workbench-store/state')

    await openPlan(
      HOME_WORKSPACE_ID,
      'home-plan',
      '.vixl/plans/home-plan/PLAN.md',
      'Home plan',
    )

    expect(getUserHomeDir).toHaveBeenCalled()
    expect(homeRootPath.value).toBe('/Users/test-home')
    expect(tabs.value).toHaveLength(1)
    expect(tabs.value[0]).toMatchObject({
      type: 'plan',
      projectId: HOME_WORKSPACE_ID,
      label: 'Home plan',
      payload: {
        planId: 'home-plan',
        path: '.vixl/plans/home-plan/PLAN.md',
      },
    })
  })

  it('stores a project-relative path when given an absolute home plan path', async () => {
    const { openPlan } = await import('@/composables/workbench-store/open-tabs')
    const { tabs } = await import('@/composables/workbench-store/state')

    await openPlan(
      HOME_WORKSPACE_ID,
      'my-plan',
      '/Users/test-home/.vixl/plans/my-plan/PLAN.md',
      'My plan',
    )

    expect(tabs.value[0]?.payload).toEqual({
      planId: 'my-plan',
      path: '.vixl/plans/my-plan/PLAN.md',
    })
  })

  it('does not look up the home dir for a fleet project plan', async () => {
    const { openPlan } = await import('@/composables/workbench-store/open-tabs')
    const { tabs, homeRootPath } = await import('@/composables/workbench-store/state')

    await openPlan('proj-1', 'fleet-plan', '.vixl/plans/fleet-plan/PLAN.md')

    expect(getUserHomeDir).not.toHaveBeenCalled()
    expect(homeRootPath.value).toBeNull()
    expect(tabs.value[0]?.projectId).toBe('proj-1')
  })
})

describe('openPlan label', () => {
  beforeEach(async () => {
    const { tabs, activeTabId, homeRootPath, homeRoot } = await import(
      '@/composables/workbench-store/state'
    )
    tabs.value = []
    activeTabId.value = null
    homeRootPath.value = null
    homeRoot.promise = null
  })

  afterEach(async () => {
    const { tabs, activeTabId, homeRootPath, homeRoot } = await import(
      '@/composables/workbench-store/state'
    )
    tabs.value = []
    activeTabId.value = null
    homeRootPath.value = null
    homeRoot.promise = null
  })

  it('updates the existing plan tab label when a new label is provided', async () => {
    const { openPlan } = await import('@/composables/workbench-store/open-tabs')
    const { tabs, activeTabId } = await import('@/composables/workbench-store/state')

    await openPlan('proj-1', 'fleet-plan', '.vixl/plans/fleet-plan/PLAN.md', 'Old title')
    const existingId = tabs.value[0]?.id

    await openPlan('proj-1', 'fleet-plan', '.vixl/plans/fleet-plan/PLAN.md', 'New title')

    expect(tabs.value).toHaveLength(1)
    expect(tabs.value[0]?.id).toBe(existingId)
    expect(tabs.value[0]?.label).toBe('New title')
    expect(activeTabId.value).toBe(existingId)
  })

  it('keeps the existing plan tab label when label is omitted', async () => {
    const { openPlan } = await import('@/composables/workbench-store/open-tabs')
    const { tabs } = await import('@/composables/workbench-store/state')

    await openPlan('proj-1', 'fleet-plan', '.vixl/plans/fleet-plan/PLAN.md', 'Old title')

    await openPlan('proj-1', 'fleet-plan', '.vixl/plans/fleet-plan/PLAN.md')

    expect(tabs.value).toHaveLength(1)
    expect(tabs.value[0]?.label).toBe('Old title')
  })
})
