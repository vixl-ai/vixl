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

import useFleetRegistry, {
  getFleetProjects,
  upsertFleetProject,
} from '@/composables/use-fleet-registry'

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

  it('ensures CodeGraph for a worktree project root, not the parent root', async () => {
    const parent = {
      id: 'proj-parent',
      name: 'Parent',
      slug: 'parent',
      root_path: '/tmp/parent',
      last_opened: '2026-01-01T00:00:00.000Z',
    }
    const worktree = {
      id: 'proj-worktree',
      name: 'feature',
      slug: 'feature',
      root_path: '/tmp/worktrees/parent/feature',
      last_opened: '2026-01-03T00:00:00.000Z',
      worktree: {
        parent_id: parent.id,
        branch: 'feature',
        managed: true,
      },
    }
    registryListProjects.mockResolvedValue([parent, worktree])
    getActiveProjectId.mockResolvedValue(parent.id)

    const fleet = useFleetRegistry()
    await fleet.refresh()
    await fleet.setActiveProject(worktree.id)

    expect(ensureCodeGraph).toHaveBeenCalledWith('/tmp/worktrees/parent/feature')
    expect(ensureCodeGraph).not.toHaveBeenCalledWith('/tmp/parent')
  })
})

const worktreeChildOlder = {
  id: 'proj-wt-old',
  name: 'review',
  slug: 'review',
  root_path: '/tmp/worktrees/alpha/review',
  last_opened: '2026-01-03T00:00:00.000Z',
  worktree: {
    parent_id: projectA.id,
    branch: 'review',
    managed: true,
  },
}

const worktreeChildNewer = {
  id: 'proj-wt-new',
  name: 'feature',
  slug: 'feature',
  root_path: '/tmp/worktrees/alpha/feature',
  last_opened: '2026-01-04T00:00:00.000Z',
  worktree: {
    parent_id: projectA.id,
    branch: 'feature',
    managed: true,
  },
}

const worktreeOtherParent = {
  id: 'proj-wt-beta',
  name: 'hotfix',
  slug: 'hotfix',
  root_path: '/tmp/worktrees/beta/hotfix',
  last_opened: '2026-01-05T00:00:00.000Z',
  worktree: {
    parent_id: projectB.id,
    branch: 'hotfix',
    managed: false,
  },
}

describe('useFleetRegistry worktree mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isTauri.mockReturnValue(true)
    getActiveProjectId.mockResolvedValue(null)
    hasProjectVixl.mockResolvedValue(true)
    const fleet = useFleetRegistry()
    fleet.projects.value = []
    fleet.activeProjectId.value = null
  })

  it('maps a snake_case worktree record onto WorktreeLink', async () => {
    registryListProjects.mockResolvedValue([worktreeChildNewer])

    const fleet = useFleetRegistry()
    await fleet.refresh()

    expect(fleet.projects.value).toEqual([
      {
        id: 'proj-wt-new',
        name: 'feature',
        slug: 'feature',
        rootPath: '/tmp/worktrees/alpha/feature',
        lastOpened: '2026-01-04T00:00:00.000Z',
        worktree: {
          parentId: projectA.id,
          branch: 'feature',
          managed: true,
        },
      },
    ])
  })

  it('omits worktree on records that have no link', async () => {
    registryListProjects.mockResolvedValue([projectA])

    const fleet = useFleetRegistry()
    await fleet.refresh()

    expect(fleet.projects.value).toEqual([
      {
        id: 'proj-a',
        name: 'Alpha',
        slug: 'alpha',
        rootPath: '/tmp/project-a',
        lastOpened: '2026-01-01T00:00:00.000Z',
      },
    ])
    expect(fleet.projects.value[0]).not.toHaveProperty('worktree')
  })
})

describe('useFleetRegistry worktreesOf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isTauri.mockReturnValue(true)
    getActiveProjectId.mockResolvedValue(null)
    hasProjectVixl.mockResolvedValue(true)
    registryListProjects.mockResolvedValue([
      projectA,
      projectB,
      worktreeChildOlder,
      worktreeChildNewer,
      worktreeOtherParent,
    ])
    const fleet = useFleetRegistry()
    fleet.projects.value = []
    fleet.activeProjectId.value = null
  })

  it('returns only children of the given id, sorted by lastOpened desc', async () => {
    const fleet = useFleetRegistry()
    await fleet.refresh()

    expect(fleet.worktreesOf(projectA.id).map((project) => project.id)).toEqual([
      worktreeChildNewer.id,
      worktreeChildOlder.id,
    ])
    expect(fleet.worktreesOf(projectB.id).map((project) => project.id)).toEqual([
      worktreeOtherParent.id,
    ])
    expect(fleet.worktreesOf('missing')).toEqual([])
  })
})

describe('useFleetRegistry upsertFleetProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const fleet = useFleetRegistry()
    fleet.projects.value = [
      {
        id: projectA.id,
        name: projectA.name,
        slug: projectA.slug,
        rootPath: projectA.root_path,
        lastOpened: projectA.last_opened,
      },
    ]
  })

  it('inserts or replaces by id and sorts lastOpened desc', () => {
    upsertFleetProject(worktreeChildOlder)
    expect(getFleetProjects().map((project) => project.id)).toEqual([
      worktreeChildOlder.id,
      projectA.id,
    ])

    upsertFleetProject(worktreeChildNewer)
    expect(getFleetProjects().map((project) => project.id)).toEqual([
      worktreeChildNewer.id,
      worktreeChildOlder.id,
      projectA.id,
    ])

    upsertFleetProject({
      ...worktreeChildNewer,
      root_path: '/tmp/worktrees/alpha/feature-renamed',
      last_opened: '2026-01-06T00:00:00.000Z',
    })
    const projects = getFleetProjects()
    expect(projects.filter((project) => project.id === worktreeChildNewer.id)).toHaveLength(1)
    expect(projects[0]).toMatchObject({
      id: worktreeChildNewer.id,
      rootPath: '/tmp/worktrees/alpha/feature-renamed',
      lastOpened: '2026-01-06T00:00:00.000Z',
      worktree: {
        parentId: projectA.id,
        branch: 'feature',
        managed: true,
      },
    })
  })
})
