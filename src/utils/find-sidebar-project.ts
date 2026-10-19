import type { FleetSidebarProject } from '@/types/fleet/fleet-sidebar-project'

export const flattenSidebarProjects = (
  projects: FleetSidebarProject[],
): FleetSidebarProject[] => {
  const result: FleetSidebarProject[] = []
  for (const project of projects) {
    result.push(project)
    if (project.worktrees && project.worktrees.length > 0) {
      result.push(...project.worktrees)
    }
  }
  return result
}

export const findSidebarProject = (
  projects: FleetSidebarProject[],
  slug: string,
): FleetSidebarProject | undefined =>
  flattenSidebarProjects(projects).find((project) => project.slug === slug)
