export type HarnessWorkspaceMember = {
  slug: string
  name: string
  rootPath: string
}

export type HarnessWorkspace = {
  projectSlug: string
  projectRoot: string
  projectName: string
  standalone?: boolean
  members?: HarnessWorkspaceMember[]
}
