import { isHomeWorkspaceRoot } from '@/services/config/is-home-workspace-root'
import { getVixlDir, listVixlFiles, type ProjectFileEntry } from '@/services/vixl/vixl-tauri'
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

export default async (input: {
  standalone?: boolean
  projectRoot: string
}): Promise<string> => {
  const personal = await resolvePersonalSource()
  const personalContents = personal ? await loadAgentsMd(personal.entries, personal.root) : ''

  const includeProject = !input.standalone && !(await isHomeWorkspaceRoot(input.projectRoot))
  const project = includeProject ? await resolveProjectSource(input.projectRoot) : null
  const projectContents = project ? await loadAgentsMd(project.entries, project.root) : ''

  return [guidanceBlock('Personal', personalContents), guidanceBlock('Project', projectContents)]
    .filter(Boolean)
    .join('\n\n')
}
