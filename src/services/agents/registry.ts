import {
  fsReadFile,
  getVixlDir,
  listVixlFiles,
  type ProjectFileEntry,
} from '@/services/vixl/vixl-tauri'
import parseAgentMarkdown from '@/services/agents/parse-agent-markdown'
import { isUnreachableHostError } from '@/services/harness/ssh/map-error'
import type { AgentIndexEntry, AgentScope, ResolvedAgentDefinition } from '@/types/agents'
import slugifyName from '@/utils/slugify-name'

const stemFromFilename = (filename: string): string => filename.replace(/\.md$/i, '')

const normalizeMatchKey = (value: string): string => value.trim().toLowerCase()

const toIndexEntry = (entry: ProjectFileEntry, scope: AgentScope): AgentIndexEntry => {
  const id = stemFromFilename(entry.name)
  return {
    id,
    name: id,
    description: entry.description?.trim() || id,
    scope,
    path: entry.path,
  }
}

const listPersonalAgentIndex = async (): Promise<AgentIndexEntry[]> => {
  const files = await listVixlFiles('personal', 'agents').catch(() => [])
  return files.map((file) => toIndexEntry(file, 'user'))
}

const listProjectAgentIndex = async (projectRoot: string): Promise<AgentIndexEntry[]> => {
  const files = await listVixlFiles('project', 'agents', projectRoot)
  return files.map((file) => toIndexEntry(file, 'project'))
}

const relativeFromRoot = (
  readRoot: string,
  absolutePath: string,
  fallbackRelative: string,
): string => {
  const prefix = readRoot.endsWith('/') ? readRoot : `${readRoot}/`
  if (absolutePath.startsWith(prefix)) {
    return absolutePath.slice(prefix.length)
  }
  return fallbackRelative
}

const matchesAgentName = (
  definition: ResolvedAgentDefinition,
  needle: string,
): boolean => {
  const id = normalizeMatchKey(definition.id)
  const name = normalizeMatchKey(definition.name)
  if (id === needle || name === needle) {
    return true
  }
  const needleSlug = slugifyName(needle)
  return slugifyName(definition.id) === needleSlug || slugifyName(definition.name) === needleSlug
}

const loadAgentDefinition = async (
  entry: AgentIndexEntry,
  projectRoot: string | null,
  personalDir: string | null,
): Promise<ResolvedAgentDefinition | null> => {
  const filename = `${entry.id}.md`
  let readRoot: string
  let relativePath: string

  if (entry.scope === 'user') {
    if (!personalDir) {
      return null
    }
    readRoot = personalDir
    relativePath = relativeFromRoot(personalDir, entry.path, `agents/${filename}`)
  } else {
    if (!projectRoot) {
      return null
    }
    readRoot = projectRoot
    relativePath = relativeFromRoot(projectRoot, entry.path, `.vixl/agents/${filename}`)
  }

  let content = ''
  try {
    const result = await fsReadFile({ projectRoot: readRoot, path: relativePath })
    content = result.content
  } catch (error) {
    if (entry.scope === 'project' && isUnreachableHostError(error)) {
      throw error
    }
    return null
  }

  const parsed = parseAgentMarkdown(content)
  const name = parsed.frontmatter.name?.trim() || entry.id
  const description =
    parsed.frontmatter.description?.trim() || entry.description.trim() || name

  return {
    id: entry.id,
    name,
    description,
    model: parsed.frontmatter.model?.trim() || undefined,
    reasoning: parsed.frontmatter.reasoning,
    tools: parsed.frontmatter.tools,
    body: parsed.body,
    path: entry.path,
    scope: entry.scope,
  }
}

export const listAgentIndex = async (
  projectRoot: string | null,
): Promise<AgentIndexEntry[]> => {
  const personal = await listPersonalAgentIndex()
  const byName = new Map<string, AgentIndexEntry>()
  for (const agent of personal) {
    byName.set(agent.name.toLowerCase(), agent)
  }
  if (!projectRoot) {
    return [...byName.values()]
  }
  const project = await listProjectAgentIndex(projectRoot)
  for (const agent of project) {
    byName.set(agent.name.toLowerCase(), agent)
  }
  return [...byName.values()]
}

export const listAgentDefinitions = async (
  projectRoot: string | null,
): Promise<ResolvedAgentDefinition[]> => {
  const index = await listAgentIndex(projectRoot)
  const needsPersonal = index.some((entry) => entry.scope === 'user')
  const personalDir = needsPersonal ? await getVixlDir('personal') : null
  const definitions: ResolvedAgentDefinition[] = []

  for (const entry of index) {
    const definition = await loadAgentDefinition(entry, projectRoot, personalDir)
    if (definition) {
      definitions.push(definition)
    }
  }

  return definitions
}

export const resolveAgentDefinition = async (
  projectRoot: string | null,
  agentName: string,
): Promise<ResolvedAgentDefinition | null> => {
  const needle = normalizeMatchKey(agentName)
  if (!needle) {
    return null
  }

  const definitions = await listAgentDefinitions(projectRoot)
  return definitions.find((definition) => matchesAgentName(definition, needle)) ?? null
}
