import type { ModelMessage } from 'ai'
import { messageHasImagePart } from './estimate-model-message-tokens'
import { omitCompactFileParts } from './truncate-model-message'

/**
 * Drop all but the last `keepLast` image payloads from a shallow copy of the
 * transcript. Used before the checkpoint generation call so the summarizer
 * never pays for stale screenshots; the live rewrite has its own retention.
 */
export default (messages: ModelMessage[], keepLast = 1): ModelMessage[] => {
  if (!messages.some(messageHasImagePart)) {
    return messages
  }
  const pruned = [...messages]
  let keep = keepLast
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || !messageHasImagePart(message)) {
      continue
    }
    if (keep > 0) {
      keep -= 1
      continue
    }
    pruned[index] = omitCompactFileParts(message)
  }
  return pruned
}
