import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import modelMessageText from '@/services/harness/compact/model-message-text'

const ascii = (text: string): number[] =>
  Array.from(text).map((char) => char.charCodeAt(0))

const base64 = (bytes: number[]): string => {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

const pngDataUrl = (width: number, height: number, padChars = 0): string => {
  const header = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
    ...ascii('IHDR'),
    (width >>> 24) & 0xff,
    (width >> 16) & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    (height >>> 24) & 0xff,
    (height >> 16) & 0xff,
    (height >> 8) & 0xff,
    height & 0xff,
  ]
  return `data:image/png;base64,${base64(header)}${'A'.repeat(padChars)}`
}

describe('modelMessageText', () => {
  it('labels image parts with filename and pixel dimensions', () => {
    const message: ModelMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'Reference attached.' },
        {
          type: 'file',
          mediaType: 'image/png',
          filename: 'ref.jpg',
          data: pngDataUrl(1846, 2032, 1_500_000),
        },
      ],
    }

    const text = modelMessageText(message)

    expect(text).toContain('[image ref.jpg 1846x2032]')
    expect(text).toContain('Reference attached.')
    expect(text).not.toContain('A'.repeat(1000))
  })

  it('redacts data URLs embedded in tool result text', () => {
    const message: ModelMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'blender_look',
          output: {
            type: 'text',
            value: `screenshot:\n${pngDataUrl(640, 480, 100_000)}`,
          },
        },
      ],
    }

    const text = modelMessageText(message)

    expect(text).toContain('screenshot:')
    expect(text).toContain('[image]')
    expect(text).not.toContain('A'.repeat(1000))
    expect(text.length).toBeLessThan(500)
  })

  it('leaves plain text content untouched', () => {
    const message: ModelMessage = { role: 'user', content: 'plain question' }
    expect(modelMessageText(message)).toBe('plain question')
  })
})
