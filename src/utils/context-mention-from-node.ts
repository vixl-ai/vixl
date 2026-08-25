import type { Editor } from '@tiptap/core'
import type { ContextMention } from '@/types/harness/context-mention'

export type ChatMentionNodeAttrs = {
  id: string | null
  label: string | null
  mentionSuggestionChar?: string | null
  mentionType: ContextMention['type'] | null
  path: string | null
  name: string | null
  query: string | null
  startLine: number | null
  endLine: number | null
  content: string | null
}

const asType = (value: unknown): ContextMention['type'] | null => {
  if (
    value === 'file' ||
    value === 'folder' ||
    value === 'rule' ||
    value === 'skill' ||
    value === 'symbol' ||
    value === 'codebase'
  ) {
    return value
  }
  return null
}

const mentionKey = (mention: ContextMention): string => {
  if (mention.type === 'file' || mention.type === 'folder') {
    return `${mention.type}:${mention.path}`
  }
  if (mention.type === 'symbol') {
    return `symbol:${mention.path}:${mention.name}:${mention.startLine ?? ''}:${mention.endLine ?? ''}`
  }
  if (mention.type === 'codebase') {
    return `codebase:${mention.query}`
  }
  return `${mention.type}:${mention.name}`
}

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

const toAttrs = (mention: ContextMention): ChatMentionNodeAttrs => {
  const label = mentionLabel(mention)
  const base: ChatMentionNodeAttrs = {
    id: mentionKey(mention),
    label,
    mentionSuggestionChar: mention.type === 'skill' ? '/' : '@',
    mentionType: mention.type,
    path: null,
    name: null,
    query: null,
    startLine: null,
    endLine: null,
    content: null,
  }

  if (mention.type === 'file' || mention.type === 'folder') {
    return { ...base, path: mention.path }
  }
  if (mention.type === 'symbol') {
    return {
      ...base,
      path: mention.path,
      name: mention.name,
      startLine: mention.startLine ?? null,
      endLine: mention.endLine ?? null,
      content: mention.content ?? null,
    }
  }
  if (mention.type === 'codebase') {
    return {
      ...base,
      query: mention.query,
      content: mention.content ?? null,
    }
  }
  return { ...base, name: mention.name }
}

const fromAttrs = (attrs: Partial<ChatMentionNodeAttrs>): ContextMention | null => {
  // Slash suggestions always insert skills; prefer the trigger char over the
  // default mentionType ('file') when attrs were partially applied.
  if (attrs.mentionSuggestionChar === '/' || attrs.mentionType === 'skill') {
    const name = attrs.name?.trim() || attrs.label?.trim()
    if (!name) {
      return null
    }
    return { type: 'skill', name }
  }

  const mentionType = asType(attrs.mentionType)
  if (!mentionType) {
    return null
  }

  if (mentionType === 'file') {
    const path = attrs.path?.trim() || attrs.label?.trim() || attrs.id?.trim()
    if (!path) {
      return null
    }
    return { type: 'file', path }
  }

  if (mentionType === 'folder') {
    const path = attrs.path?.trim() || attrs.label?.trim() || attrs.id?.trim()
    if (!path) {
      return null
    }
    return { type: 'folder', path }
  }

  if (mentionType === 'symbol') {
    const name = attrs.name?.trim() || attrs.label?.trim()
    const path = attrs.path?.trim()
    if (!name || !path) {
      return null
    }
    const mention: ContextMention = {
      type: 'symbol',
      path,
      name,
    }
    if (typeof attrs.startLine === 'number') {
      mention.startLine = attrs.startLine
    }
    if (typeof attrs.endLine === 'number') {
      mention.endLine = attrs.endLine
    }
    if (attrs.content?.trim()) {
      mention.content = attrs.content
    }
    return mention
  }

  if (mentionType === 'codebase') {
    const query = attrs.query?.trim() || attrs.label?.replace(/^codebase\s+/i, '').trim()
    if (!query) {
      return null
    }
    const mention: ContextMention = { type: 'codebase', query }
    if (attrs.content?.trim()) {
      mention.content = attrs.content
    }
    return mention
  }

  const name = attrs.name?.trim() || attrs.label?.trim()
  if (!name) {
    return null
  }
  return { type: 'rule', name }
}

const collectFromEditor = (editor: Editor): ContextMention[] => {
  const mentions: ContextMention[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'mention') {
      return
    }
    const mention = fromAttrs(node.attrs as Partial<ChatMentionNodeAttrs>)
    if (mention) {
      mentions.push(mention)
    }
  })
  return mentions
}

const mergePreservingContent = (
  next: ContextMention[],
  previous: ContextMention[],
): ContextMention[] => {
  const previousByKey = new Map(previous.map((mention) => [mentionKey(mention), mention]))
  return next.map((mention) => {
    const prior = previousByKey.get(mentionKey(mention))
    if (!prior) {
      return mention
    }
    if (
      (mention.type === 'codebase' || mention.type === 'symbol') &&
      !mention.content &&
      prior.type === mention.type &&
      prior.content
    ) {
      return { ...mention, content: prior.content }
    }
    return mention
  })
}

export default {
  mentionKey,
  mentionLabel,
  toAttrs,
  fromAttrs,
  collectFromEditor,
  mergePreservingContent,
}
