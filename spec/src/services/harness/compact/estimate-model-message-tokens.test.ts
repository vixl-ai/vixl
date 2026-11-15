import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import estimateTextTokens from '@/utils/estimate-text-tokens'
import { MAX_IMAGE_TOKENS } from '@/utils/estimate-image-tokens'
import estimateModelMessageTokens, {
  messageHasImagePart,
} from '@/services/harness/compact/estimate-model-message-tokens'

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

const imageMessage = (payloadChars: number): ModelMessage => ({
  role: 'user',
  content: [
    { type: 'text', text: 'Inspect this reference render.' },
    {
      type: 'file',
      mediaType: 'image/png',
      filename: 'ref.png',
      data: pngDataUrl(1846, 2032, payloadChars),
    },
  ],
})

describe('estimateModelMessageTokens', () => {
  it('charges a 2MB base64 image at its bounded pixel cost, not char cost', () => {
    const message = imageMessage(2_000_000)
    const legacy = estimateTextTokens(JSON.stringify(message))
    const estimate = estimateModelMessageTokens(message)

    expect(legacy).toBeGreaterThan(500_000)
    expect(estimate).toBeLessThanOrEqual(MAX_IMAGE_TOKENS + 100)
    expect(estimate).toBeGreaterThanOrEqual(MAX_IMAGE_TOKENS)
  })

  it('estimates plain text messages close to the old JSON heuristic', () => {
    const text = 'Find the auth bug in login.ts and explain the fix.'
    const message: ModelMessage = { role: 'user', content: text }
    const legacy = estimateTextTokens(JSON.stringify(message))
    const estimate = estimateModelMessageTokens(message)

    expect(estimate).toBeGreaterThan(0)
    expect(estimate).toBeLessThanOrEqual(legacy)
    expect(estimate).toBeGreaterThanOrEqual(estimateTextTokens(text))
  })

  it('counts images embedded as data URLs inside tool result text', () => {
    const embedded = `Captured viewport:\n${pngDataUrl(1024, 768, 400_000)}\nend`
    const message: ModelMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'blender_look',
          output: { type: 'text', value: embedded },
        },
      ],
    }
    const legacy = estimateTextTokens(JSON.stringify(message))
    const estimate = estimateModelMessageTokens(message)

    // 1024x768 -> ceil(1024/28)*ceil(768/28) = 37*28 = 1036
    expect(legacy).toBeGreaterThan(90_000)
    expect(estimate).toBeLessThan(2_000)
    expect(estimate).toBeGreaterThanOrEqual(1036)
  })

  it('keeps byte-based estimates for non-image file parts', () => {
    const message: ModelMessage = {
      role: 'user',
      content: [
        { type: 'file', mediaType: 'application/pdf', data: 'A'.repeat(40_000) },
      ],
    }
    expect(estimateModelMessageTokens(message)).toBeGreaterThan(8_000)
  })

  it('bounds unknown-format image payloads at the flat fallback', () => {
    const message: ModelMessage = {
      role: 'user',
      content: [
        { type: 'file', mediaType: 'image/png', data: 'A'.repeat(300_000) },
      ],
    }
    expect(estimateModelMessageTokens(message)).toBeLessThanOrEqual(1_700)
  })
})

describe('messageHasImagePart', () => {
  it('detects user image file parts and deprecated image parts', () => {
    expect(messageHasImagePart(imageMessage(100))).toBe(true)
    expect(
      messageHasImagePart({
        role: 'user',
        content: [{ type: 'image', image: pngDataUrl(64, 64) }],
      }),
    ).toBe(true)
  })

  it('detects images nested in tool-result content outputs', () => {
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
              { type: 'text', text: 'ok' },
              {
                type: 'file',
                mediaType: 'image/png',
                data: { type: 'data', data: pngDataUrl(64, 64) },
              },
            ],
          },
        },
      ],
    }
    expect(messageHasImagePart(message)).toBe(true)
  })

  it('is false for text and non-image files', () => {
    expect(messageHasImagePart({ role: 'user', content: 'hello' })).toBe(false)
    expect(
      messageHasImagePart({
        role: 'user',
        content: [
          { type: 'file', mediaType: 'application/pdf', data: 'AAAA' },
        ],
      }),
    ).toBe(false)
  })
})
