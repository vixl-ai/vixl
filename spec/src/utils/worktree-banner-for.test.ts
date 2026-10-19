import { describe, expect, it } from 'vitest'
import type { FleetProject } from '@/types/fleet/fleet-project'
import worktreeBannerFor from '@/utils/worktree-banner-for'

const parent: FleetProject = {
  id: 'proj-parent',
  name: 'Demo',
  slug: 'demo',
  rootPath: '/tmp/demo',
  lastOpened: '2026-01-01T00:00:00.000Z',
}

const linked: FleetProject = {
  id: 'proj-wt',
  name: 'feature',
  slug: 'demo-feature',
  rootPath: '/tmp/worktrees/demo/feature',
  lastOpened: '2026-01-02T00:00:00.000Z',
  worktree: {
    parentId: 'proj-parent',
    branch: 'vixl/feature',
    managed: true,
  },
}

describe('worktreeBannerFor', () => {
  it('returns null for a normal project', () => {
    expect(worktreeBannerFor(parent, [parent])).toBeNull()
  })

  it('links to the parent when it is in the fleet', () => {
    expect(worktreeBannerFor(linked, [parent, linked])).toEqual({
      branch: 'vixl/feature',
      parentName: 'Demo',
      parentSlug: 'demo',
    })
  })

  it('omits the parent link when the parent is missing', () => {
    expect(worktreeBannerFor(linked, [linked])).toEqual({
      branch: 'vixl/feature',
      parentName: null,
      parentSlug: null,
    })
  })
})
