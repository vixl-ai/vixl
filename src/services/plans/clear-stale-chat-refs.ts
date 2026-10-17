import parsePlan from '@/services/plans/parse-plan'
import { fsReadFile, fsWriteFile } from '@/services/vixl/vixl-tauri'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

const CHAT_REF_KEYS = ['sourceChatId', 'lastBuildChatId'] as const

const staleChatIdFromLine = (line: string, staleChatIds: string[]): string | null => {
  const trimmed = line.trim()
  for (const key of CHAT_REF_KEYS) {
    if (!trimmed.startsWith(`${key}:`)) {
      continue
    }
    const raw = trimmed.slice(key.length + 1).trim()
    const id =
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw
    if (staleChatIds.includes(id)) {
      return id
    }
  }
  return null
}

export default async (args: {
  projectRoot: string
  path: string
  staleChatIds: string[]
}): Promise<void> => {
  if (args.staleChatIds.length === 0) {
    return
  }

  const { content } = await fsReadFile({
    projectRoot: args.projectRoot,
    path: args.path,
  })
  const match = content.match(FRONTMATTER_RE)
  if (!match) {
    throw new Error('Plan file is missing YAML frontmatter.')
  }

  const yaml = match[1] ?? ''
  const body = match[2] ?? ''
  const lines = yaml.split('\n')
  let droppedLastBuildChatId = false
  let droppedSourceChatId = false
  const nextLines = lines.filter((line) => {
    if (staleChatIdFromLine(line, args.staleChatIds) === null) {
      return true
    }
    const trimmed = line.trim()
    if (trimmed.startsWith('lastBuildChatId:')) {
      droppedLastBuildChatId = true
    }
    if (trimmed.startsWith('sourceChatId:')) {
      droppedSourceChatId = true
    }
    return false
  })
  const withoutPairedSlugs = nextLines.filter((line) => {
    const trimmed = line.trim()
    if (droppedLastBuildChatId && trimmed.startsWith('lastBuildChatSlug:')) {
      return false
    }
    if (droppedSourceChatId && trimmed.startsWith('sourceChatSlug:')) {
      return false
    }
    return true
  })
  if (withoutPairedSlugs.length === lines.length) {
    return
  }

  const nextYaml = withoutPairedSlugs.join('\n').trimEnd()
  const nextContent = `---\n${nextYaml}\n---\n\n${body.trimStart()}`

  const parsed = parsePlan(nextContent)
  if (parsed.parseError) {
    throw new Error(parsed.parseError)
  }

  await fsWriteFile({
    projectRoot: args.projectRoot,
    path: args.path,
    content: nextContent,
  })
}
