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
    value === 'agent' ||
    value === 'symbol' ||
    value === 'codebase'
  ) {
    return value
  }
  return null
}

const mentionPayload = (mention: ContextMention): string => {
  switch (mention.type) {
    case 'file':
      return `file\0${mention.path}\0${mention.content ?? ''}`
    case 'folder':
      return `folder\0${mention.path}\0${mention.listing ?? ''}`
    case 'rule':
      return `rule\0${mention.name}`
    case 'skill':
      return `skill\0${mention.name}`
    case 'agent':
      return `agent\0${mention.name}`
    case 'symbol':
      return [
        'symbol',
        mention.path,
        mention.name,
        mention.startLine ?? '',
        mention.endLine ?? '',
        mention.content ?? '',
      ].join('\0')
    case 'codebase':
      return `codebase\0${mention.query}\0${mention.content ?? ''}`
  }
}

const mentionsEqual = (
  left: ContextMention[],
  right: ContextMention[],
): boolean => {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    const current = left[index]
    const next = right[index]
    if (!current || !next || mentionPayload(current) !== mentionPayload(next)) {
      return false
    }
  }
  return true
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
    mentionSuggestionChar:
      mention.type === 'skill' || mention.type === 'agent' ? '/' : '@',
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
  const slashName = attrs.name?.trim() || attrs.label?.trim() || ''

  // Explicit agent nodes must win even when the slash char is also present.
  if (attrs.mentionType === 'agent') {
    if (!slashName) {
      return null
    }
    return { type: 'agent', name: slashName }
  }

  // Slash suggestions insert skills; prefer the trigger char over the default
  // mentionType ('file') when attrs were partially applied (legacy nodes).
  if (attrs.mentionSuggestionChar === '/' || attrs.mentionType === 'skill') {
    if (!slashName) {
      return null
    }
    return { type: 'skill', name: slashName }
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
  mentionsEqual,
  toAttrs,
  fromAttrs,
  collectFromEditor,
  mergePreservingContent,
}
