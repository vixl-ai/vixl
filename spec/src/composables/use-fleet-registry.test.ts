import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../test-utils/mocks/vixl-tauri'
import { sessionTrusts } from '@/services/mcp/mcp-trust'
import connectionKey from '@/services/mcp/connection-key'

const {
  registryListProjects,
  registrySetActiveProject,
  getActiveProjectId,
  hasProjectVixl,
  lspPrefetchDefaults,
  isTauri,
  ensureCodeGraph,
  stopServer,
  mcpStop,
} = vi.hoisted(() => ({
  registryListProjects: vi.fn<() => Promise<unknown[]>>(async () => []),
  registrySetActiveProject: vi.fn<(projectId: string | null) => Promise<void>>(
    async () => undefined,
  ),
  getActiveProjectId: vi.fn<() => Promise<string | null>>(async () => null),
  hasProjectVixl: vi.fn<(root: string) => Promise<boolean>>(async () => true),
  lspPrefetchDefaults: vi.fn<() => Promise<void>>(async () => undefined),
  isTauri: vi.fn<() => boolean>(() => true),
  ensureCodeGraph: vi.fn<(root: string) => Promise<void>>(async () => undefined),
  stopServer: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  mcpStop: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    isTauri: () => isTauri(),
    registryListProjects: () => registryListProjects(),
    registrySetActiveProject: (projectId: string | null) =>
      registrySetActiveProject(projectId),
    getActiveProjectId: () => getActiveProjectId(),
    hasProjectVixl: (root: string) => hasProjectVixl(root),
    lspPrefetchDefaults: () => lspPrefetchDefaults(),
  }),
)

vi.mock('@/services/codegraph/ensure-codegraph', () => ({
  default: (root: string) => ensureCodeGraph(root),
}))

vi.mock('@/composables/mcp-servers/lifecycle', () => ({
  stopServer: (...args: unknown[]) => stopServer(...args),
}))

vi.mock('@/services/mcp/mcp-runtime', () => ({
  default: {
    stop: (...args: unknown[]) => mcpStop(...args),
  },
}))

import useFleetRegistry from '@/composables/use-fleet-registry'

const projectA = {
  id: 'proj-a',
  name: 'Alpha',
  slug: 'alpha',
  root_path: '/tmp/project-a',
  last_opened: '2026-01-01T00:00:00.000Z',
}

const projectB = {
  id: 'proj-b',
  name: 'Beta',
  slug: 'beta',
  root_path: '/tmp/project-b',
  last_opened: '2026-01-02T00:00:00.000Z',
}

describe('useFleetRegistry setActiveProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionTrusts.clear()
    isTauri.mockReturnValue(true)
    registryListProjects.mockResolvedValue([projectA, projectB])
    getActiveProjectId.mockResolvedValue(projectA.id)
    hasProjectVixl.mockResolvedValue(true)
    const fleet = useFleetRegistry()
    fleet.projects.value = []
    fleet.activeProjectId.value = null
  })

  it('stops nothing and does not clear sessionTrusts when switching projects', async () => {
    sessionTrusts.set(connectionKey('/tmp/project-a', 'github'), 'fp-a')
    sessionTrusts.set(connectionKey('personal', 'brave'), 'fp-brave')
    const snapshot = [...sessionTrusts.entries()]
    const clearSpy = vi.spyOn(sessionTrusts, 'clear')

    const fleet = useFleetRegistry()
    await fleet.refresh()
    expect(fleet.activeProjectId.value).toBe(projectA.id)

    await fleet.setActiveProject(projectB.id)

    expect(registrySetActiveProject).toHaveBeenCalledWith(projectB.id)
    expect(fleet.activeProjectId.value).toBe(projectB.id)
    expect(stopServer).not.toHaveBeenCalled()
    expect(mcpStop).not.toHaveBeenCalled()
    expect(clearSpy).not.toHaveBeenCalled()
    expect([...sessionTrusts.entries()]).toEqual(snapshot)
  })
})
