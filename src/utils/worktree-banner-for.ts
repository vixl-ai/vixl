import type { FleetProject } from '@/types/fleet/fleet-project'

export type WorktreeBanner = {
  branch: string
  parentName: string | null
  parentSlug: string | null
}

export default (
  project: FleetProject | null | undefined,
  projects: FleetProject[],
): WorktreeBanner | null => {
  const link = project?.worktree
  if (!link) {
    return null
  }

  const parent = projects.find((entry) => entry.id === link.parentId)
  return {
    branch: link.branch,
    parentName: parent?.name ?? null,
    parentSlug: parent?.slug ?? null,
  }
}
