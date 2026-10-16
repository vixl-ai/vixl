import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'

export const hasGroupMembers = (
  members: HarnessWorkspaceMember[] | undefined,
): members is HarnessWorkspaceMember[] => Boolean(members && members.length >= 2)

export const isLiveMemberRoot = (rootPath: string): boolean =>
  rootPath.trim().length > 0

export const membersFromDeclaredSlugs = (
  memberSlugs: readonly string[],
  projects: readonly Pick<HarnessWorkspaceMember, 'slug' | 'name' | 'rootPath'>[],
): HarnessWorkspaceMember[] => {
  const keepMissingSlugs = memberSlugs.length >= 2
  const members: HarnessWorkspaceMember[] = []
  for (const memberSlug of memberSlugs) {
    const project = projects.find((entry) => entry.slug === memberSlug)
    if (project) {
      members.push({
        slug: project.slug,
        name: project.name,
        rootPath: project.rootPath,
      })
      continue
    }
    if (keepMissingSlugs) {
      members.push({
        slug: memberSlug,
        name: memberSlug,
        rootPath: '',
      })
    }
  }
  return members
}

export const parseMemberQualifiedName = (
  raw: string,
  members: HarnessWorkspaceMember[] | undefined,
): { member: HarnessWorkspaceMember; name: string } | null => {
  if (!hasGroupMembers(members)) {
    return null
  }
  const trimmed = raw.trim()
  const colon = trimmed.indexOf(':')
  if (colon <= 0 || colon === trimmed.length - 1) {
    return null
  }
  const slug = trimmed.slice(0, colon)
  const name = trimmed.slice(colon + 1)
  const member = members.find((entry) => entry.slug === slug)
  if (!member) {
    return null
  }
  return { member, name }
}

export const parseMemberQualifiedPath = (
  raw: string,
  members: HarnessWorkspaceMember[] | undefined,
): { member: HarnessWorkspaceMember; path: string } | null => {
  if (!hasGroupMembers(members)) {
    return null
  }
  const trimmed = raw.trim()
  const slash = trimmed.indexOf('/')
  if (slash <= 0 || slash === trimmed.length - 1) {
    return null
  }
  const slug = trimmed.slice(0, slash)
  const path = trimmed.slice(slash + 1)
  const member = members.find((entry) => entry.slug === slug)
  if (!member) {
    return null
  }
  return { member, path }
}

export const formatAmbiguousMemberOptions = (
  hits: Array<{ slug: string }>,
  name: string,
): string => hits.map((hit) => `${hit.slug}:${name}`).join(', ')
