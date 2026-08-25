import { describe, expect, it } from 'vitest'
import {
  formatMentionBlocks,
  formatMentionsAsText,
} from '@/services/context/system-prompt-parts/format-mentions'
import type { ContextMention } from '@/types/harness/context-mention'

const fileMention: ContextMention = {
  type: 'file',
  path: 'src/utils/foo.ts',
  content: 'export const foo = 1',
}

describe('format-mentions', () => {
  it('formats a file mention as a readable text block', () => {
    const text = formatMentionsAsText([fileMention])

    expect(text).toContain('File src/utils/foo.ts:')
    expect(text).toContain('export const foo = 1')
  })

  it('splits skills from other mentions in formatMentionBlocks', () => {
    const blocks = formatMentionBlocks([
      fileMention,
      { type: 'skill', name: 'ask' },
    ])

    expect(blocks.skills).toBe('Skill ask')
    expect(blocks.mentions).toContain('File src/utils/foo.ts:')
    expect(blocks.mentions).toContain('export const foo = 1')
  })
})
