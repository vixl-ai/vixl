import type { UIMessage } from 'ai'
import { appendChatLine, updateChatMeta } from '@/services/vixl/vixl-tauri'

export type PersistCompactionCheckpointInput = {
  projectSlug: string
  chatId: string
  summary: string
  focus?: string
  messages: UIMessage[]
}

export type PersistCompactionCheckpointResult = {
  summary: string
  includeFromCreatedAt: string
  checkpointLineId: string
}

export default async (
  input: PersistCompactionCheckpointInput,
): Promise<PersistCompactionCheckpointResult> => {
  const { projectSlug, chatId, summary, focus } = input
  const checkpointLineId = crypto.randomUUID()
  const nowIso = new Date().toISOString()
  const includeFromCreatedAt = nowIso

  await appendChatLine(projectSlug, chatId, {
    id: checkpointLineId,
    role: 'assistant',
    parts: [],
    createdAt: nowIso,
    harnessEvent: {
      type: 'compaction',
      summary,
      focus: focus ?? null,
    },
  })

  await updateChatMeta(projectSlug, chatId, {
    activeContext: {
      checkpointLineId,
      includeFromCreatedAt,
      summary,
    },
  })

  return { summary, includeFromCreatedAt, checkpointLineId }
}
