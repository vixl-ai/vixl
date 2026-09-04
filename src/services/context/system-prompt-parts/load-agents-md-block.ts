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

export default async (input: {
  standalone?: boolean
  projectRoot: string
}): Promise<string> => {
  const source = input.standalone
    ? await resolvePersonalSource()
    : await resolveProjectSource(input.projectRoot)
  if (!source) {
    return ''
  }
  const contents = await loadAgentsMd(source.entries, source.root)
  return contents ? `AGENTS.md guidance:\n\n${contents}` : ''
}
