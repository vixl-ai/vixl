import { describe, expect, it } from 'vitest'
import contextMentionFromNode from '@/utils/context-mention-from-node'

describe('contextMentionFromNode.mentionsEqual', () => {
  it('treats a fresh copy of the same mentions as unchanged', () => {
    const left = [{ type: 'file' as const, path: 'src/main.ts' }]
    const right = [{ type: 'file' as const, path: 'src/main.ts' }]
    expect(contextMentionFromNode.mentionsEqual(left, right)).toBe(true)
  })

  it('notices when mention file content arrives', () => {
    const left = [{ type: 'file' as const, path: 'src/main.ts' }]
    const right = [{ type: 'file' as const, path: 'src/main.ts', content: 'fn main' }]
    expect(contextMentionFromNode.mentionsEqual(left, right)).toBe(false)
  })

  it('treats missing and empty mention content as the same', () => {
    const left = [{ type: 'file' as const, path: 'src/main.ts' }]
    const right = [{ type: 'file' as const, path: 'src/main.ts', content: '' }]
    expect(contextMentionFromNode.mentionsEqual(left, right)).toBe(true)
  })
})

describe('contextMentionFromNode.fromAttrs', () => {
  it('treats slash suggestion chars as skills even when mentionType defaults to file', () => {
    expect(
      contextMentionFromNode.fromAttrs({
        id: 'skill:ask',
        label: 'ask',
        mentionSuggestionChar: '/',
        mentionType: 'file',
        path: null,
        name: 'ask',
        query: null,
        startLine: null,
        endLine: null,
        content: null,
      }),
    ).toEqual({ type: 'skill', name: 'ask' })
  })

  it('keeps explicit skill mentionType', () => {
    expect(
      contextMentionFromNode.fromAttrs({
        id: 'skill:ask',
        label: 'ask',
        mentionSuggestionChar: '/',
        mentionType: 'skill',
        path: null,
        name: 'ask',
        query: null,
        startLine: null,
        endLine: null,
        content: null,
      }),
    ).toEqual({ type: 'skill', name: 'ask' })
  })

  it('does not coerce slash plus mentionType agent to skill', () => {
    expect(
      contextMentionFromNode.fromAttrs({
        id: 'agent:reviewer',
        label: 'reviewer',
        mentionSuggestionChar: '/',
        mentionType: 'agent',
        path: null,
        name: 'reviewer',
        query: null,
        startLine: null,
        endLine: null,
        content: null,
      }),
    ).toEqual({ type: 'agent', name: 'reviewer' })
  })

  it('round-trips agent mentions with a slash suggestion char', () => {
    const mention = { type: 'agent' as const, name: 'reviewer' }
    const attrs = contextMentionFromNode.toAttrs(mention)
    expect(attrs.mentionType).toBe('agent')
    expect(attrs.mentionSuggestionChar).toBe('/')
    expect(contextMentionFromNode.fromAttrs(attrs)).toEqual(mention)
  })

  it('keeps @ file mentions', () => {
    expect(
      contextMentionFromNode.fromAttrs({
        id: 'file:src/a.ts',
        label: 'src/a.ts',
        mentionSuggestionChar: '@',
        mentionType: 'file',
        path: 'src/a.ts',
        name: null,
        query: null,
        startLine: null,
        endLine: null,
        content: null,
      }),
    ).toEqual({ type: 'file', path: 'src/a.ts' })
  })

  it('round-trips symbol mentions through attrs', () => {
    const mention = {
      type: 'symbol' as const,
      path: 'src/utils/foo.ts',
      name: 'splitChatMentionText',
      startLine: 10,
      endLine: 20,
    }

    const attrs = contextMentionFromNode.toAttrs(mention)
    expect(attrs.mentionType).toBe('symbol')
    expect(attrs.path).toBe('src/utils/foo.ts')
    expect(attrs.name).toBe('splitChatMentionText')
    expect(contextMentionFromNode.fromAttrs(attrs)).toEqual(mention)
  })
})
