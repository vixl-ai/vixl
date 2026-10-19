import type { FleetProject } from '@/types/fleet/fleet-project'
import type { FleetProjectGroup } from '@/types/fleet/fleet-project-group'
import type { FleetSidebarProject } from '@/types/fleet/fleet-sidebar-project'

export type ProjectRowWorkspace = {
  slug: string
  projectRoot: string
  activateId: string
  remove: () => Promise<void>
}

export default (
  project: FleetSidebarProject,
  fleet: {
    groups: { value: FleetProjectGroup[] }
    projects: { value: FleetProject[] }
    removeGroup: (id: string) => Promise<void>
    removeProject: (id: string) => Promise<void>
  },
): ProjectRowWorkspace | null => {
  if (project.kind === 'group') {
    const group = fleet.groups.value.find((item) => item.slug === project.slug)
    const primarySlug = group?.memberSlugs[0]
    const primary = primarySlug
      ? fleet.projects.value.find((item) => item.slug === primarySlug)
      : undefined
    if (!group || !primary) {
      return null
    }
    return {
      slug: group.slug,
      projectRoot: primary.rootPath,
      activateId: primary.id,
      remove: () => fleet.removeGroup(group.id),
    }
  }

  const fleetProject = fleet.projects.value.find((item) => item.slug === project.slug)
  if (!fleetProject) {
    return null
  }
  return {
    slug: fleetProject.slug,
    projectRoot: fleetProject.rootPath,
    activateId: fleetProject.id,
    remove: () => fleet.removeProject(fleetProject.id),
  }
}
