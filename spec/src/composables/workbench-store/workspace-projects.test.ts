import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri())

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

import useFleetRegistry from '@/composables/use-fleet-registry'
import {
  listGroupMemberProjects,
  listWorkspaceProjects,
  resolvePrimaryWorkspaceProjectId,
  resolveWorkspaceProjectId,
} from '@/composables/workbench-store/helpers'
import { HOME_WORKSPACE_ID } from '@/constants/home-chat'
import type { FleetProject } from '@/types/fleet/fleet-project'
import type { FleetProjectGroup } from '@/types/fleet/fleet-project-group'

const alpha: FleetProject = {
  id: 'proj-a',
  name: 'Alpha',
  slug: 'alpha',
  rootPath: '/tmp/alpha',
  lastOpened: '2026-01-01T00:00:00.000Z',
}

const beta: FleetProject = {
  id: 'proj-b',
  name: 'Beta',
  slug: 'beta',
  rootPath: '/tmp/beta',
  lastOpened: '2026-01-02T00:00:00.000Z',
}

const stack: FleetProjectGroup = {
  id: 'group-1',
  name: 'Stack',
  slug: 'stack',
  memberSlugs: ['beta', 'alpha'],
  lastOpened: '2026-01-03T00:00:00.000Z',
}

describe('workbench workspace projects', () => {
  beforeEach(() => {
    const fleet = useFleetRegistry()
    fleet.projects.value = [alpha, beta]
    fleet.groups.value = [stack]
    fleet.activeProjectId.value = alpha.id
  })

  it('lists group members in memberSlugs order (primary first)', () => {
    expect(listGroupMemberProjects('stack').map((project) => project.slug)).toEqual([
      'beta',
      'alpha',
    ])
  })

  it('exposes group members as workspace projects for a group slug', () => {
    expect(listWorkspaceProjects('stack').map((project) => project.id)).toEqual([
      'proj-b',
      'proj-a',
    ])
    expect(resolvePrimaryWorkspaceProjectId('stack')).toBe('proj-b')
  })

  it('keeps a single project slug as one workspace project', () => {
    expect(listWorkspaceProjects('alpha')).toEqual([alpha])
    expect(resolvePrimaryWorkspaceProjectId('alpha')).toBe('proj-a')
  })

  it('leaves resolveWorkspaceProjectId unchanged (active project)', () => {
    expect(resolveWorkspaceProjectId()).toBe(alpha.id)
  })

  it('falls back to the active project when the slug is unknown', () => {
    expect(listWorkspaceProjects('missing')).toEqual([alpha])
    expect(resolvePrimaryWorkspaceProjectId('missing')).toBe(alpha.id)
  })

  it('returns home when the context slug is the home workspace', () => {
    const fleet = useFleetRegistry()
    fleet.activeProjectId.value = null
    expect(listWorkspaceProjects(HOME_WORKSPACE_ID)).toEqual([])
    expect(resolvePrimaryWorkspaceProjectId(HOME_WORKSPACE_ID)).toBe(
      HOME_WORKSPACE_ID,
    )
  })
})
