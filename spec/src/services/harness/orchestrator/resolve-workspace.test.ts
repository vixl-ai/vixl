import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessWorkspace } from '@/types/harness/harness-workspace'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const {
  registryListProjects,
  registryListGroups,
  getActiveProjectId,
  hasProjectVixl,
  ensureCodeGraph,
  lspWorkspaceProfile,
  lspEnsureServer,
} = vi.hoisted(() => ({
  registryListProjects: vi.fn<() => Promise<unknown[]>>(async () => []),
  registryListGroups: vi.fn<() => Promise<unknown[]>>(async () => []),
  getActiveProjectId: vi.fn<() => Promise<string | null>>(async () => null),
  hasProjectVixl: vi.fn<(root: string) => Promise<boolean>>(async () => true),
  ensureCodeGraph: vi.fn<(root: string) => Promise<void>>(async () => undefined),
  lspWorkspaceProfile: vi.fn<(root: string) => Promise<{
    vueNuxt: boolean
    warm: string[]
    warmExtensions: string[]
  }>>(async () => ({
    vueNuxt: false,
    warm: ['typescript'],
    warmExtensions: ['ts'],
  })),
  lspEnsureServer: vi.fn<(ext: string, root?: string | null) => Promise<unknown>>(async () => ({})),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    registryListProjects: () => registryListProjects(),
    registryListGroups: () => registryListGroups(),
    getActiveProjectId: () => getActiveProjectId(),
    hasProjectVixl: (root: string) => hasProjectVixl(root),
    lspWorkspaceProfile: (root: string) => lspWorkspaceProfile(root),
    lspEnsureServer: (ext: string, root?: string | null) => lspEnsureServer(ext, root),
  }),
)

vi.mock('@/services/codegraph/ensure-codegraph', () => ({
  default: (root: string) => ensureCodeGraph(root),
}))

import { HOME_CHAT_SLUG } from '@/constants/home-chat'
import useFleetRegistry from '@/composables/use-fleet-registry'
import resolveLiveWorkspace, {
  resolveGroupMembers,
} from '@/services/harness/orchestrator/resolve-workspace'

const apiRecord = {
  id: 'p-api',
  name: 'API',
  slug: 'api',
  root_path: '/tmp/api',
  last_opened: '2026-01-01T00:00:00.000Z',
}

const webRecord = {
  id: 'p-web',
  name: 'Web',
  slug: 'web',
  root_path: '/tmp/web',
  last_opened: '2026-01-01T00:00:00.000Z',
}

const stackRecord = {
  id: 'g-stack',
  name: 'Stack',
  slug: 'stack',
  member_slugs: ['api', 'web'],
  last_opened: '2026-01-01T00:00:00.000Z',
}

const expectedMembers = [
  { slug: 'api', name: 'API', rootPath: '/tmp/api' },
  { slug: 'web', name: 'Web', rootPath: '/tmp/web' },
]

describe('resolveGroupMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registryListProjects.mockResolvedValue([apiRecord, webRecord])
    registryListGroups.mockResolvedValue([stackRecord])
    getActiveProjectId.mockResolvedValue(apiRecord.id)
    hasProjectVixl.mockResolvedValue(true)
    const fleet = useFleetRegistry()
    fleet.projects.value = []
    fleet.groups.value = []
    fleet.loaded.value = false
    fleet.activeProjectId.value = null
  })

  it('returns undefined when the workspace slug is not a group', async () => {
    registryListGroups.mockResolvedValue([])
    const members = await resolveGroupMembers({
      projectSlug: 'api',
      projectRoot: '/tmp/api',
      projectName: 'API',
    })
    expect(members).toBeUndefined()
  })

  it('maps group member slugs to projects with the primary member first when state is preloaded', async () => {
    const fleet = useFleetRegistry()
    await fleet.refresh()
    registryListProjects.mockClear()
    registryListGroups.mockClear()

    const members = await resolveGroupMembers({
      projectSlug: 'stack',
      projectRoot: '/tmp/api',
      projectName: 'Stack',
    })
    expect(members).toEqual(expectedMembers)
    expect(registryListProjects).not.toHaveBeenCalled()
    expect(registryListGroups).not.toHaveBeenCalled()
  })

  it('loads the fleet registry when state is empty', async () => {
    const members = await resolveGroupMembers({
      projectSlug: 'stack',
      projectRoot: '/tmp/api',
      projectName: 'Stack',
    })
    expect(registryListProjects).toHaveBeenCalled()
    expect(registryListGroups).toHaveBeenCalled()
    expect(members).toEqual(expectedMembers)
  })

  it('keeps missing group slugs so a deleted member does not collapse to single-root', async () => {
    registryListProjects.mockResolvedValue([apiRecord])
    const members = await resolveGroupMembers({
      projectSlug: 'stack',
      projectRoot: '/tmp/api',
      projectName: 'Stack',
    })
    expect(members).toEqual([
      { slug: 'api', name: 'API', rootPath: '/tmp/api' },
      { slug: 'web', name: 'web', rootPath: '' },
    ])
  })

  it('returns undefined when every declared member slug is missing', async () => {
    registryListProjects.mockResolvedValue([])
    const members = await resolveGroupMembers({
      projectSlug: 'stack',
      projectRoot: '/tmp/api',
      projectName: 'Stack',
    })
    expect(members).toBeUndefined()
  })
})

describe('resolveLiveWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registryListProjects.mockResolvedValue([apiRecord, webRecord])
    registryListGroups.mockResolvedValue([stackRecord])
    getActiveProjectId.mockResolvedValue(apiRecord.id)
    hasProjectVixl.mockResolvedValue(true)
    const fleet = useFleetRegistry()
    fleet.projects.value = []
    fleet.groups.value = []
    fleet.loaded.value = false
    fleet.activeProjectId.value = null
  })

  it('attaches members when the workspace slug is a group and members are absent', async () => {
    const workspace: HarnessWorkspace = {
      projectSlug: 'stack',
      projectRoot: '/tmp/api',
      projectName: 'Stack',
    }
    const resolved = await resolveLiveWorkspace(workspace)
    expect(resolved).toBe(workspace)
    expect(workspace.members).toEqual(expectedMembers)
  })

  it('refreshes members when group membership changes between turns', async () => {
    const workspace: HarnessWorkspace = {
      projectSlug: 'stack',
      projectRoot: '/tmp/api',
      projectName: 'Stack',
    }
    await resolveLiveWorkspace(workspace)
    expect(workspace.members).toEqual(expectedMembers)

    const fleet = useFleetRegistry()
    fleet.groups.value = [
      {
        id: 'g-stack',
        name: 'Stack',
        slug: 'stack',
        memberSlugs: ['web'],
        lastOpened: '2026-01-01T00:00:00.000Z',
      },
    ]
    fleet.projects.value = [
      {
        id: 'p-web',
        name: 'Web',
        slug: 'web',
        rootPath: '/tmp/web-v2',
        lastOpened: '2026-01-01T00:00:00.000Z',
      },
    ]

    await resolveLiveWorkspace(workspace)
    expect(workspace.members).toEqual([
      { slug: 'web', name: 'Web', rootPath: '/tmp/web-v2' },
    ])
  })

  it('clears members after the slug moves onto a registered project', async () => {
    const workspace: HarnessWorkspace = {
      projectSlug: 'stack',
      projectRoot: '/tmp/api',
      projectName: 'Stack',
    }
    await resolveLiveWorkspace(workspace)
    expect(workspace.members).toEqual(expectedMembers)

    workspace.projectSlug = 'api'
    workspace.projectRoot = '/tmp/api'
    workspace.projectName = 'API'

    await resolveLiveWorkspace(workspace)
    expect(workspace.members).toBeUndefined()
  })

  it('clears members when the slug is the home workspace', async () => {
    const workspace: HarnessWorkspace = {
      projectSlug: 'stack',
      projectRoot: '/tmp/api',
      projectName: 'Stack',
    }
    await resolveLiveWorkspace(workspace)
    expect(workspace.members).toEqual(expectedMembers)

    workspace.projectSlug = HOME_CHAT_SLUG
    workspace.projectRoot = '/tmp/home'
    workspace.projectName = 'Home'

    await resolveLiveWorkspace(workspace)
    expect(workspace.members).toBeUndefined()
  })

  it('keeps last known members when the group is deleted', async () => {
    const workspace: HarnessWorkspace = {
      projectSlug: 'stack',
      projectRoot: '/tmp/api',
      projectName: 'Stack',
    }
    await resolveLiveWorkspace(workspace)
    expect(workspace.members).toEqual(expectedMembers)

    const fleet = useFleetRegistry()
    fleet.groups.value = []

    await resolveLiveWorkspace(workspace)
    expect(workspace.members).toEqual(expectedMembers)
  })

  it('keeps last known members when every member slug fails to resolve', async () => {
    const workspace: HarnessWorkspace = {
      projectSlug: 'stack',
      projectRoot: '/tmp/api',
      projectName: 'Stack',
    }
    await resolveLiveWorkspace(workspace)
    expect(workspace.members).toEqual(expectedMembers)

    const fleet = useFleetRegistry()
    fleet.projects.value = []

    await resolveLiveWorkspace(workspace)
    expect(workspace.members).toEqual(expectedMembers)
  })

  it('leaves single-project workspaces without members', async () => {
    registryListGroups.mockResolvedValue([])
    const workspace: HarnessWorkspace = {
      projectSlug: 'api',
      projectRoot: '/tmp/api',
      projectName: 'API',
    }
    await resolveLiveWorkspace(workspace)
    expect(workspace.members).toBeUndefined()
    expect(ensureCodeGraph).not.toHaveBeenCalled()
  })

  it('keeps multi-root members when one group project is missing from the fleet', async () => {
    registryListProjects.mockResolvedValue([apiRecord])
    const workspace: HarnessWorkspace = {
      projectSlug: 'stack',
      projectRoot: '/tmp/api',
      projectName: 'Stack',
    }
    await resolveLiveWorkspace(workspace)
    expect(workspace.members).toEqual([
      { slug: 'api', name: 'API', rootPath: '/tmp/api' },
      { slug: 'web', name: 'web', rootPath: '' },
    ])
    expect(ensureCodeGraph).toHaveBeenCalledWith('/tmp/api')
    expect(ensureCodeGraph).toHaveBeenCalledTimes(1)
  })

  it('starts CodeGraph for every member root on a group workspace', async () => {
    const workspace: HarnessWorkspace = {
      projectSlug: 'stack',
      projectRoot: '/tmp/api',
      projectName: 'Stack',
    }
    await resolveLiveWorkspace(workspace)
    expect(ensureCodeGraph).toHaveBeenCalledWith('/tmp/api')
    expect(ensureCodeGraph).toHaveBeenCalledWith('/tmp/web')
    expect(ensureCodeGraph).toHaveBeenCalledTimes(2)
    expect(lspEnsureServer).toHaveBeenCalledWith('ts', '/tmp/api')
    expect(lspEnsureServer).toHaveBeenCalledWith('ts', '/tmp/web')
  })
})
