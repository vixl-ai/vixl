import type { FleetProject } from '@/types/fleet/fleet-project'
import type { FleetProjectGroup } from '@/types/fleet/fleet-project-group'

export const isGroupSlug = (
  slug: string,
  groups: readonly FleetProjectGroup[],
): boolean => groups.some((group) => group.slug === slug)

export const primaryProjectForSlug = (
  slug: string,
  projects: readonly FleetProject[],
  groups: readonly FleetProjectGroup[] = [],
): FleetProject | null => {
  const direct = projects.find((project) => project.slug === slug)
  if (direct) {
    return direct
  }
  const group = groups.find((entry) => entry.slug === slug)
  const primarySlug = group?.memberSlugs[0]
  if (!primarySlug) {
    return null
  }
  return projects.find((project) => project.slug === primarySlug) ?? null
}
