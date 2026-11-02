import { isHomeWorkspaceRoot } from '@/services/config/is-home-workspace-root'
import { wrapRemoteAgentsMd, sshHostFromRoot } from '@/services/harness/ssh/model-errors'
import { isUnreachableHostError } from '@/services/harness/ssh/map-error'
import { fsReadFile, getVixlDir, listVixlFiles, type ProjectFileEntry } from '@/services/vixl/vixl-tauri'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import { isSshProjectRoot } from '@/utils/ssh-project-root'
import loadAgentsMd from './format-agents-md'

type AgentsMdSource = {
  entries: ProjectFileEntry[]
  root: string
}

const REMOTE_AGENTS_MD_CANDIDATES = ['.vixl/AGENTS.md', '.vixl/agents.md', 'AGENTS.md']

const resolvePersonalSource = async (): Promise<AgentsMdSource | null> => {
  const root = await getVixlDir('personal').catch(() => null)
  if (!root) {
    return null
  }
  const entries = await listVixlFiles('personal', 'agents-md').catch(() => [])
  return { root, entries }
}

const resolveProjectSource = async (projectRoot: string): Promise<AgentsMdSource> => {
  try {
    const entries = await listVixlFiles('project', 'agents-md', projectRoot)
    return { root: projectRoot, entries }
  } catch (error) {
    if (isUnreachableHostError(error)) {
      throw error
    }
    return { root: projectRoot, entries: [] }
  }
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

const loadRemoteAgentsMd = async (projectRoot: string): Promise<{ path: string; text: string } | null> => {
  for (const path of REMOTE_AGENTS_MD_CANDIDATES) {
    try {
      const result = await fsReadFile({ projectRoot, path })
      const text = result.content.trim()
      if (text) {
        return { path, text }
      }
    } catch (error) {
      if (isUnreachableHostError(error)) {
        throw error
      }
      continue
    }
  }
  return null
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
    if (isSshProjectRoot(member.rootPath)) {
      const remote = await loadRemoteAgentsMd(member.rootPath)
      if (!remote) {
        continue
      }
      lines.push(
        `Project ${member.slug} has its own AGENTS.md at ${member.slug}/${remote.path}; read it before editing files there.`,
      )
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
  let projectBlock = ''
  if (includeProject && isSshProjectRoot(input.projectRoot)) {
    const remote = await loadRemoteAgentsMd(input.projectRoot)
    if (remote) {
      projectBlock = wrapRemoteAgentsMd(sshHostFromRoot(input.projectRoot), remote.text)
    }
  } else if (includeProject) {
    const project = await resolveProjectSource(input.projectRoot)
    const projectContents = await loadAgentsMd(project.entries, project.root)
    projectBlock = guidanceBlock('Project', projectContents)
  }

  const memberIndex =
    input.standalone ? '' : await formatMemberAgentsMdIndex(input.members, input.projectRoot)

  return [
    guidanceBlock('Personal', personalContents),
    projectBlock,
    memberIndex,
  ]
    .filter(Boolean)
    .join('\n\n')
}
