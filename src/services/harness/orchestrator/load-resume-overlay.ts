import type { ModelMessage } from 'ai'
import itemsByChat from './resume-overlay-cache'

export default (
  chatId: string,
): {
  spawnMessages: ModelMessage[]
  wakes: Array<{ content: string; toolCallIds: string[] }>
  deliveredResultKeys: string[]
} => {
  const items = itemsByChat.get(chatId) ?? []
  const spawnMessages: ModelMessage[] = []
  const wakes: Array<{ content: string; toolCallIds: string[] }> = []
  const deliveredResultKeys: string[] = []
  for (const item of items) {
    if (item.kind === 'spawn') {
      spawnMessages.push(...item.messages)
      continue
    }
    wakes.push({ content: item.content, toolCallIds: item.toolCallIds })
    deliveredResultKeys.push(...item.resultKeys)
  }
  return { spawnMessages, wakes, deliveredResultKeys }
}
