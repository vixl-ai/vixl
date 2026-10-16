import { isHomeWorkspaceRoot } from '@/services/config/is-home-workspace-root'
import { getVixlDir, listVixlFiles, type ProjectFileEntry } from '@/services/vixl/vixl-tauri'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import loadAgentsMd from './format-agents-md'

type AgentsMdSource = {
  entries: ProjectFileEntry[]
  root: string
}

const resolvePersonalSource = async (): Promise<AgentsMdSource | null> => {
  const root = await getVixlDir('personal').catch(() => null)
  if (!root) {
    return null
  }
  const entries = await listVixlFiles('personal', 'agents-md').catch(() => [])
  return { root, entries }
}

const resolveProjectSource = async (projectRoot: string): Promise<AgentsMdSource> => {
  const entries = await listVixlFiles('project', 'agents-md', projectRoot).catch(
    () => [],
  )
  return { root: projectRoot, entries }
}

const guidanceBlock = (label: string, contents: string): string =>
  contents ? `${label} AGENTS.md guidance:\n\n${contents}` : ''

const relativeAgentsMdPath = (entry: ProjectFileEntry, projectRoot: string): string => {
  const prefix = projectRoot.endsWith('/') ? projectRoot : `${projectRoot}/`
  if (entry.path.startsWith(prefix)) {
    return entry.path.slice(prefix.length)
  }
  return 'AGENTS.md'
}

const formatMemberAgentsMdIndex = async (
  members: HarnessWorkspaceMember[] | undefined,
  projectRoot: string,
): Promise<string> => {
  if (!members || members.length === 0) {
    return ''
  }

  const lines: string[] = []
  for (const member of members) {
    if (member.rootPath === projectRoot) {
      continue
    }
    const source = await resolveProjectSource(member.rootPath)
    const entry = source.entries[0]
    if (!entry) {
      continue
    }
    const relative = relativeAgentsMdPath(entry, member.rootPath)
    lines.push(
      `Project ${member.slug} has its own AGENTS.md at ${member.slug}/${relative}; read it before editing files there.`,
    )
  }
  return lines.join('\n')
}

export default async (input: {
  standalone?: boolean
  projectRoot: string
  members?: HarnessWorkspaceMember[]
}): Promise<string> => {
  const personal = await resolvePersonalSource()
  const personalContents = personal ? await loadAgentsMd(personal.entries, personal.root) : ''

  const includeProject = !input.standalone && !(await isHomeWorkspaceRoot(input.projectRoot))
  const project = includeProject ? await resolveProjectSource(input.projectRoot) : null
  const projectContents = project ? await loadAgentsMd(project.entries, project.root) : ''

  const memberIndex =
    input.standalone ? '' : await formatMemberAgentsMdIndex(input.members, input.projectRoot)

  return [
    guidanceBlock('Personal', personalContents),
    guidanceBlock('Project', projectContents),
    memberIndex,
  ]
    .filter(Boolean)
    .join('\n\n')
}
