import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'

export const SINGLE_PROJECT_SECTION = (
  projectName: string,
  projectRoot: string,
): string =>
  [
    `Project: ${projectName} (${projectRoot})`,
    'Workspace tools are scoped to this repo. For work in another project, move this chat there with move_workspace when available, or suggest the user open a chat in that project.',
  ].join('\n')

const MULTI_PROJECT_RULES = [
  'Paths must be prefixed with a member slug, for example api/src/index.ts.',
  'run_terminal cwd and git tools repo take a member slug. Default is the primary project (first listed).',
  'Make one git commit per repo. Never stage files across projects.',
  'Search without a path filter covers all projects.',
].join('\n')

export const formatMemberProjectSection = (
  members: HarnessWorkspaceMember[],
): string => {
  const rows = members.map(
    (member) => `- ${member.slug} | ${member.name} | ${member.rootPath}`,
  )
  return [`Projects (slug, name, path):`, ...rows, '', MULTI_PROJECT_RULES].join('\n')
}

export default (
  projectName: string,
  projectRoot: string,
  members?: HarnessWorkspaceMember[],
): string => {
  if (!members || members.length === 0) {
    return SINGLE_PROJECT_SECTION(projectName, projectRoot)
  }
  return formatMemberProjectSection(members)
}
