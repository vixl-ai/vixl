import type { MentionHighlight } from '@/types/chat/mention-highlight'
import type { ContextMention } from '@/types/harness/context-mention'

const mentionLabel = (mention: ContextMention): string => {
  if (mention.type === 'file' || mention.type === 'folder') {
    return mention.path
  }
  if (mention.type === 'symbol') {
    return mention.name
  }
  if (mention.type === 'codebase') {
    return `codebase ${mention.query}`
  }
  return mention.name
}

export default (mention: ContextMention): MentionHighlight => {
  if (mention.type === 'skill') {
    return { kind: 'skill', token: `/${mention.name}` }
  }
  return { kind: 'mention', token: `@${mentionLabel(mention)}` }
}
