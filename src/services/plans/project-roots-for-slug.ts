import { isHomeChatSlug } from '@/constants/home-chat'

type ProjectRoot = {
  slug: string
  rootPath: string
}

type ProjectGroup = {
  slug: string
  memberSlugs: string[]
}

export default (args: {
  projectSlug: string
  homeDir?: string
  projects: ProjectRoot[]
  groups: ProjectGroup[]
}): string[] => {
  if (isHomeChatSlug(args.projectSlug)) {
    return args.homeDir ? [args.homeDir] : []
  }
  const group = args.groups.find((item) => item.slug === args.projectSlug)
  if (group) {
    return args.projects
      .filter((item) => group.memberSlugs.includes(item.slug))
      .map((item) => item.rootPath)
  }
  const project = args.projects.find((item) => item.slug === args.projectSlug)
  return project ? [project.rootPath] : []
}
