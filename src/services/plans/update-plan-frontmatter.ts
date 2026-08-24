import parsePlan from '@/services/plans/parse-plan'
import { fsReadFile, fsWriteFile } from '@/services/vixl/vixl-tauri'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

const BUILD_FIELD_KEYS = ['builtAt', 'lastBuildChatId', 'lastBuildModel'] as const

export type PlanBuildFrontmatterPatch = {
  builtAt: string
  lastBuildChatId: string
  lastBuildModel: string
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
  const lines = yaml.split('\n').filter(
    (line) => !BUILD_FIELD_KEYS.some((key) => line.trim().startsWith(`${key}:`)),
  )
  const trimmedYaml = lines.join('\n').trimEnd()
  const buildLines = [
    `builtAt: ${args.patch.builtAt}`,
    `lastBuildChatId: ${args.patch.lastBuildChatId}`,
    `lastBuildModel: ${JSON.stringify(args.patch.lastBuildModel)}`,
  ]
  const nextYaml = `${trimmedYaml}\n${buildLines.join('\n')}`
  const nextContent = `---\n${nextYaml}\n---\n\n${body.trimStart()}`

  const parsed = parsePlan(nextContent)
  if (parsed.parseError) {
    throw new Error(parsed.parseError)
  }

  await fsWriteFile({ projectRoot: args.projectRoot, path: args.path, content: nextContent })
}
