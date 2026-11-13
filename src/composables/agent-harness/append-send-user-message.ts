import type { FileUIPart } from 'ai'
import type { ContextMention } from '@/types/harness/context-mention'
import { listSlashSkillIndex } from '@/services/skills/skill-registry'
import buildMentionHighlights from '@/utils/build-mention-highlights'
import type { AgentHarnessSession } from './types'

type AppendSendUserMessageArgs = {
  session: AgentHarnessSession
  text: string
  model: string
  files: FileUIPart[]
  mentions: ContextMention[]
  agentNames: string[]
  projectRoot: string | null
  aborted: () => boolean
  skillNames?: string[]
}

const buildUserParts = (
  text: string,
  files: FileUIPart[],
): Array<
  | { type: 'text'; text: string }
  | { type: 'file'; mediaType: string; url: string; filename?: string }
> => {
  const parts: Array<
    | { type: 'text'; text: string }
    | { type: 'file'; mediaType: string; url: string; filename?: string }
  > = []

  if (text.trim().length > 0) {
    parts.push({ type: 'text', text })
  }

  // Keep file parts on the UI message so the thread can show thumbnails.
  // Non-vision models get text placeholders later, only for
  // convertToModelMessages in the orchestrator.

  for (const file of files) {
    const url = file.url
    if (url?.startsWith('file://')) {
      parts.push({
        type: 'text',
        text: `[Attachment unavailable: ${file.filename || url}]`,
      })
      continue
    }

    if (!url) {
      continue
    }

    parts.push({
      type: 'file',
      mediaType: file.mediaType || 'image/png',
      url,
      filename: file.filename,
    })
  }

  return parts
}

export default async (
  args: AppendSendUserMessageArgs,
): Promise<{ id: string } | null> => {
  const parts = buildUserParts(args.text, args.files)
  if (args.aborted() || parts.length === 0) {
    return null
  }

  const skillNames =
    args.skillNames ??
    (await listSlashSkillIndex(args.projectRoot).catch(() => [])).map(
      (skill) => skill.name,
    )

  const mentionHighlights = buildMentionHighlights(
    args.text,
    args.mentions,
    skillNames,
    args.agentNames,
  )

  const id = crypto.randomUUID()
  args.session.appendLocalMessage({
    id,
    role: 'user',
    parts,
    metadata: {
      createdAt: new Date().toISOString(),
      model: args.model,
      ...(mentionHighlights.length > 0 ? { mentionHighlights } : {}),
    },
  })

  return { id }
}
