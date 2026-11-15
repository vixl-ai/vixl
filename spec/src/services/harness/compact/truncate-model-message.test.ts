import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import truncateModelMessage, {
  omitCompactFileParts,
} from '@/services/harness/compact/truncate-model-message'

describe('omitCompactFileParts', () => {
  it('replaces user file and image parts with a placeholder', () => {
    const message: ModelMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'See screenshot' },
        {
          type: 'file',
          mediaType: 'image/png',
          data: 'A'.repeat(8_000),
        },
        {
          type: 'image',
          image: 'B'.repeat(8_000),
        },
      ],
    }

    const omitted = omitCompactFileParts(message)

    expect(omitted).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'See screenshot' },
        { type: 'text', text: '[image omitted by compaction]' },
        { type: 'text', text: '[image omitted by compaction]' },
      ],
    })
  })

  it('replaces assistant file parts with a placeholder', () => {
    const message: ModelMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Rendered preview' },
        {
          type: 'file',
          mediaType: 'image/png',
          data: 'C'.repeat(4_000),
        },
      ],
    }

    expect(omitCompactFileParts(message)).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Rendered preview' },
        { type: 'text', text: '[image omitted by compaction]' },
      ],
    })
  })

  it('leaves string content unchanged', () => {
    const message: ModelMessage = { role: 'user', content: 'plain' }
    expect(omitCompactFileParts(message)).toBe(message)
  })

  it('omits images nested in tool-result content outputs', () => {
    const message: ModelMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'blender_look',
          output: {
            type: 'content',
            value: [
              { type: 'text', text: 'viewport' },
              {
                type: 'file',
                mediaType: 'image/png',
                data: { type: 'data', data: 'A'.repeat(8_000) },
              },
            ],
          },
        },
      ],
    }

    const omitted = omitCompactFileParts(message)

    expect(JSON.stringify(omitted)).not.toContain('A'.repeat(1000))
    expect(JSON.stringify(omitted)).toContain('[image omitted by compaction]')
    expect(JSON.stringify(omitted)).toContain('viewport')
    expect(omitted).not.toBe(message)
  })

  it('redacts data URLs in text tool outputs', () => {
    const message: ModelMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'blender_look',
          output: {
            type: 'text',
            value: `shot: data:image/png;base64,${'B'.repeat(8_000)}`,
          },
        },
      ],
    }

    expect(JSON.stringify(omitCompactFileParts(message))).not.toContain(
      'B'.repeat(1000),
    )
  })

  it('keeps image parts when keepImages is set but drops other files', () => {
    const message: ModelMessage = {
      role: 'user',
      content: [
        { type: 'file', mediaType: 'image/png', data: 'A'.repeat(8_000) },
        { type: 'file', mediaType: 'application/pdf', data: 'B'.repeat(8_000) },
      ],
    }

    const kept = omitCompactFileParts(message, { keepImages: true })

    expect(JSON.stringify(kept)).toContain('A'.repeat(1000))
    expect(JSON.stringify(kept)).not.toContain('B'.repeat(1000))
    expect(JSON.stringify(kept)).toContain('[image omitted by compaction]')
  })
})

describe('truncateModelMessage', () => {
  it('omits file parts before clipping so base64 does not survive', () => {
    const message: ModelMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'See screenshot' },
        {
          type: 'file',
          mediaType: 'image/png',
          data: 'D'.repeat(80_000),
        },
      ],
    }

    const truncated = truncateModelMessage(message, 32)

    expect(JSON.stringify(truncated)).not.toContain('D'.repeat(1000))
    expect(JSON.stringify(truncated)).toContain(
      '[image omitted by compaction]',
    )
  })

  it('still clips oversized text after file parts are omitted', () => {
    const message: ModelMessage = {
      role: 'user',
      content: 'x'.repeat(80_000),
    }

    const truncated = truncateModelMessage(message, 32)

    expect(typeof truncated.content === 'string' ? truncated.content : '').toContain(
      '[truncated for compaction]',
    )
    expect(JSON.stringify(truncated).length).toBeLessThan(
      JSON.stringify(message).length,
    )
  })
})
