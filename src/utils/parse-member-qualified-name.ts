import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'

export const hasGroupMembers = (
  members: HarnessWorkspaceMember[] | undefined,
): members is HarnessWorkspaceMember[] => Boolean(members && members.length >= 2)

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

export const formatAmbiguousMemberOptions = (
  hits: Array<{ slug: string }>,
  name: string,
): string => hits.map((hit) => `${hit.slug}:${name}`).join(', ')
