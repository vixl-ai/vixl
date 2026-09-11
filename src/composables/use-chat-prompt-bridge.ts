import { ref } from 'vue'
import type { ContextMention } from '@/types/harness/context-mention'

const mentionAppendToken = ref(0)
const pendingMention = ref<ContextMention | null>(null)

const appendMention = (path: string): void => {
  const trimmed = path.trim().replace(/^@/, '')
  if (!trimmed) {
    return
  }
  pendingMention.value = { type: 'file', path: trimmed }
  mentionAppendToken.value += 1
}

const consumePendingMention = (): ContextMention | null => {
  const mention = pendingMention.value
  pendingMention.value = null
  return mention
}

export default () => ({
  mentionAppendToken,
  appendMention,
  consumePendingMention,
})
