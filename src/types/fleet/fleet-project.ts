export type WorktreeLink = {
  parentId: string
  branch: string
  managed: boolean
}

export type FleetProject = {
  id: string
  name: string
  slug: string
  rootPath: string
  lastOpened: string
  worktree?: WorktreeLink
}

export type FleetProjectsRegistry = {
  version: 1
  projects: FleetProject[]
}

export type FleetActiveProject = {
  projectId: string | null
}
