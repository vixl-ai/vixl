import parsePlan from '@/services/plans/parse-plan'
import { fsReadFile, fsWriteFile } from '@/services/vixl/vixl-tauri'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

const BUILD_FIELD_KEYS = [
  'builtAt',
  'lastBuildChatId',
  'lastBuildChatSlug',
  'lastBuildModel',
] as const

type BuildFieldKey = (typeof BUILD_FIELD_KEYS)[number]

export type PlanBuildFrontmatterPatch = {
  builtAt?: string | null
  lastBuildChatId?: string | null
  lastBuildChatSlug?: string | null
  lastBuildModel?: string | null
}

const formatBuildLine = (key: BuildFieldKey, value: string): string => {
  if (key === 'lastBuildModel') {
    return `${key}: ${JSON.stringify(value)}`
  }
  return `${key}: ${value}`
}

export default async (args: {
  projectRoot: string
  path: string
  patch: PlanBuildFrontmatterPatch
}): Promise<void> => {
  const { content } = await fsReadFile({ projectRoot: args.projectRoot, path: args.path })
  const match = content.match(FRONTMATTER_RE)
  if (!match) {
    throw new Error('Plan file is missing YAML frontmatter.')
  }

  const yaml = match[1] ?? ''
  const body = match[2] ?? ''
  const patch = args.patch
  const lines = yaml.split('\n').filter((line) => {
    const key = BUILD_FIELD_KEYS.find((field) => line.trim().startsWith(`${field}:`))
    if (!key) {
      return true
    }
    return !(key in patch)
  })
  const buildLines = BUILD_FIELD_KEYS.flatMap((key) => {
    const value = patch[key]
    if (typeof value !== 'string') {
      return []
    }
    return [formatBuildLine(key, value)]
  })
  const trimmedYaml = lines.join('\n').trimEnd()
  const nextYaml =
    buildLines.length > 0 ? `${trimmedYaml}\n${buildLines.join('\n')}` : trimmedYaml
  const nextContent = `---\n${nextYaml}\n---\n\n${body.trimStart()}`

  const parsed = parsePlan(nextContent)
  if (parsed.parseError) {
    throw new Error(parsed.parseError)
  }

  await fsWriteFile({ projectRoot: args.projectRoot, path: args.path, content: nextContent })
}
