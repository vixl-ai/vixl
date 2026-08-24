import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import type { FleetProject } from '@/types/fleet/fleet-project'
import type { BrowserPayload } from '@/types/workbench/workbench-tab'

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    registryListProjects: vi.fn<() => Promise<unknown[]>>(async () => []),
    getActiveProjectId: vi.fn<() => Promise<string | null>>(async () => null),
    getUserHomeDir: vi.fn<() => Promise<string>>(async () => '/home/test'),
  }),
)

const project: FleetProject = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  rootPath: '/workspace/test-project',
  lastOpened: '',
}

describe('openBrowser', () => {
  beforeEach(async () => {
    const { tabs, activeTabId, homeRootPath, homeRoot } = await import(
      '@/composables/workbench-store/state'
    )
    tabs.value = []
    activeTabId.value = null
    homeRootPath.value = null
    homeRoot.promise = null

    const fleet = (await import('@/composables/use-fleet-registry')).default()
    fleet.projects.value = [project]
    fleet.activeProjectId.value = project.id
  })

  it('creates a browser tab with the project slug as workspaceId and focuses it', async () => {
    const { openBrowser } = await import('@/composables/workbench-store/open-tabs')
    const { tabs, activeTabId } = await import('@/composables/workbench-store/state')

    await openBrowser(project.id)

    expect(tabs.value).toHaveLength(1)
    const tab = tabs.value[0]!
    expect(tab.type).toBe('browser')
    expect(tab.projectId).toBe(project.id)
    expect(tab.label).toBe('Browser')
    expect((tab.payload as BrowserPayload).workspaceId).toBe(project.slug)
    expect(activeTabId.value).toBe(tab.id)
  })

  it('creates a browser tab without stealing focus when focus is false', async () => {
    const { openBrowser } = await import('@/composables/workbench-store/open-tabs')
    const { tabs, activeTabId } = await import('@/composables/workbench-store/state')

    await openBrowser(project.id, { focus: false })

    expect(tabs.value).toHaveLength(1)
    expect(activeTabId.value).toBeNull()
  })

  it('reuses an existing browser tab for the same project', async () => {
    const { openBrowser } = await import('@/composables/workbench-store/open-tabs')
    const { tabs, activeTabId } = await import('@/composables/workbench-store/state')

    await openBrowser(project.id)
    const firstId = tabs.value[0]!.id

    activeTabId.value = null
    await openBrowser(project.id)

    expect(tabs.value).toHaveLength(1)
    expect(tabs.value[0]!.id).toBe(firstId)
    expect(activeTabId.value).toBe(firstId)
  })

  it('throws when the project root cannot be resolved', async () => {
    const { openBrowser } = await import('@/composables/workbench-store/open-tabs')
    const fleet = (await import('@/composables/use-fleet-registry')).default()
    fleet.projects.value = []

    await expect(openBrowser('missing-project')).rejects.toThrow(
      'Project root is required to open the browser',
    )
  })
})
