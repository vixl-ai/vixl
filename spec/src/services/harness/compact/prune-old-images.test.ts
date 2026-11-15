import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import pruneOldImages from '@/services/harness/compact/prune-old-images'
import { messageHasImagePart } from '@/services/harness/compact/estimate-model-message-tokens'

const imageUser = (marker: string): ModelMessage => ({
  role: 'user',
  content: [
    { type: 'text', text: `render ${marker}` },
    {
      type: 'file',
      mediaType: 'image/png',
      data: `${marker}A`.repeat(500),
    },
  ],
})

const textUser = (text: string): ModelMessage => ({ role: 'user', content: text })

describe('pruneOldImages', () => {
  it('returns the same array when nothing carries an image', () => {
    const messages = [textUser('a'), textUser('b')]
    expect(pruneOldImages(messages)).toBe(messages)
  })

  it('keeps only the newest image payload', () => {
    const a = imageUser('A')
    const b = imageUser('B')
    const messages = [a, textUser('middle'), b]

    const pruned = pruneOldImages(messages)

    expect(pruned).not.toBe(messages)
    expect(pruned[2]).toBe(b)
    expect(messageHasImagePart(pruned[0] as ModelMessage)).toBe(false)
    expect(JSON.stringify(pruned[0])).toContain('[image omitted by compaction]')
    expect(JSON.stringify(pruned[0])).toContain('render A')
    expect(JSON.stringify(pruned[0])).not.toContain('AAA')
    // Originals are not mutated.
    expect(a).toBe(messages[0])
    expect(messageHasImagePart(a)).toBe(true)
  })

  it('honors keepLast above one', () => {
    const a = imageUser('A')
    const b = imageUser('B')
    const c = imageUser('C')

    const pruned = pruneOldImages([a, b, c], 2)

    expect(pruned[1]).toBe(b)
    expect(pruned[2]).toBe(c)
    expect(messageHasImagePart(pruned[0] as ModelMessage)).toBe(false)
  })
})
