import { isHomeChatSlug } from '@/constants/home-chat'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import { membersFromDeclaredSlugs } from '@/utils/parse-member-qualified-name'
import type { AgentHarnessState } from './types'

const uniquePrefixedSlugs = (paths: readonly string[]): string[] => {
  const slugs: string[] = []
  const seen = new Set<string>()
  for (const raw of paths) {
    const trimmed = raw.trim()
    const slash = trimmed.indexOf('/')
    if (slash <= 0 || slash === trimmed.length - 1) {
      continue
    }
    const slug = trimmed.slice(0, slash)
    if (seen.has(slug)) {
      continue
    }
    seen.add(slug)
    slugs.push(slug)
  }
  return slugs
}

const isKnownSingleRootSlug = (
  projectSlug: string,
  projects: readonly { slug: string }[],
): boolean =>
  isHomeChatSlug(projectSlug) || projects.some((entry) => entry.slug === projectSlug)

export default (
  fleet: AgentHarnessState['fleet'] | undefined,
  projectSlug: string,
  paths: readonly string[] = [],
): HarnessWorkspaceMember[] | undefined => {
  const groups = fleet?.groups?.value
  const projects = fleet?.projects?.value
  if (!groups || !projects) {
    return undefined
  }
  const group = groups.find((entry) => entry.slug === projectSlug)
  if (group) {
    const members = membersFromDeclaredSlugs(group.memberSlugs, projects)
    return members.length > 0 ? members : undefined
  }
  if (isKnownSingleRootSlug(projectSlug, projects)) {
    return undefined
  }
  // Chat meta does not store member slugs. When the group row is gone, keep
  // multi-root routing from slug-prefixed checkpoint keys instead of writing
  // those paths into the primary tree.
  const slugs = uniquePrefixedSlugs(paths)
  if (slugs.length === 0) {
    return undefined
  }
  if (slugs.length === 1 && slugs[0] !== projectSlug) {
    slugs.push(projectSlug)
  }
  const members = membersFromDeclaredSlugs(slugs, projects)
  return members.length > 0 ? members : undefined
}
