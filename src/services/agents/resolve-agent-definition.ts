import type { ReasoningLevel } from '@/types/models/reasoning-level'
import { listVixlFiles, fsReadFile } from '@/services/vixl/vixl-tauri'
import parseAgentMarkdown from '@/services/agents/parse-agent-markdown'

export type ResolvedAgentDefinition = {
  id: string
  name: string
  description: string
  model?: string
  reasoning?: ReasoningLevel
  tools?: string[]
  body: string
  path: string
}

const stemFromFilename = (filename: string): string =>
  filename.replace(/\.md$/i, '')

const normalizeMatchKey = (value: string): string => value.trim().toLowerCase()

const relativeAgentPath = (projectRoot: string, absolutePath: string, name: string): string => {
  const prefix = projectRoot.endsWith('/') ? projectRoot : `${projectRoot}/`
  if (absolutePath.startsWith(prefix)) {
    return absolutePath.slice(prefix.length)
  }
  const filename = name.endsWith('.md') ? name : `${name}.md`
  return `.vixl/agents/${filename}`
}

export const listAgentDefinitions = async (
  projectRoot: string,
): Promise<ResolvedAgentDefinition[]> => {
  const entries = await listVixlFiles('project', 'agents', projectRoot).catch(() => [])
  const definitions: ResolvedAgentDefinition[] = []

  for (const entry of entries) {
    const relativePath = relativeAgentPath(projectRoot, entry.path, entry.name)
    let content = ''
    try {
      const result = await fsReadFile({ projectRoot, path: relativePath })
      content = result.content
    } catch {
      continue
    }

    const parsed = parseAgentMarkdown(content)
    const id = stemFromFilename(entry.name)
    const name = parsed.frontmatter.name?.trim() || id
    const description =
      parsed.frontmatter.description?.trim() ||
      entry.description?.trim() ||
      name

    definitions.push({
      id,
      name,
      description,
      model: parsed.frontmatter.model?.trim() || undefined,
      reasoning: parsed.frontmatter.reasoning,
      tools: parsed.frontmatter.tools,
      body: parsed.body,
      path: entry.path,
    })
  }

  return definitions
}

export const resolveAgentDefinition = async (
  projectRoot: string,
  agentName: string,
): Promise<ResolvedAgentDefinition | null> => {
  const needle = normalizeMatchKey(agentName)
  if (!needle) {
    return null
  }

  const definitions = await listAgentDefinitions(projectRoot)
  return (
    definitions.find(
      (definition) =>
        normalizeMatchKey(definition.id) === needle ||
        normalizeMatchKey(definition.name) === needle,
    ) ?? null
  )
}

export default resolveAgentDefinition
