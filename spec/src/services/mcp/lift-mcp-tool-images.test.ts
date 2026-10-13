import { describe, expect, it } from 'vitest'
import liftMcpToolImages from '@/services/mcp/lift-mcp-tool-images'

const PLACEHOLDER = '[image loaded into context]'
const PNG = 'image/png'
const SOURCE = 'mcp:aseprite/screenshot'

describe('liftMcpToolImages', () => {
  it('lifts one image block in content', () => {
    const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
    const input = {
      content: [{ type: 'image', data, mimeType: PNG, alt: 'shot' }],
    }

    const { images, result, redacted } = liftMcpToolImages({
      result: input,
      source: SOURCE,
    })

    expect(redacted).toBe(1)
    expect(images).toEqual([
      {
        dataUrl: `data:${PNG};base64,${data}`,
        mediaType: PNG,
        source: SOURCE,
      },
    ])
    expect(result).toEqual({
      content: [{ type: 'image', data: PLACEHOLDER, mimeType: PNG, alt: 'shot' }],
    })
    expect(input.content[0]!.data).toBe(data)
  })

  it('lifts several image blocks', () => {
    const first = 'aaa111'
    const second = 'bbb222'
    const input = {
      content: [
        { type: 'text', text: 'before' },
        { type: 'image', data: first, mimeType: PNG },
        { type: 'image', data: second, mimeType: 'image/jpeg' },
      ],
    }

    const { images, result, redacted } = liftMcpToolImages({
      result: input,
      source: SOURCE,
    })

    expect(redacted).toBe(2)
    expect(images).toEqual([
      {
        dataUrl: `data:${PNG};base64,${first}`,
        mediaType: PNG,
        source: SOURCE,
      },
      {
        dataUrl: 'data:image/jpeg;base64,bbb222',
        mediaType: 'image/jpeg',
        source: SOURCE,
      },
    ])
    expect(result).toEqual({
      content: [
        { type: 'text', text: 'before' },
        { type: 'image', data: PLACEHOLDER, mimeType: PNG },
        { type: 'image', data: PLACEHOLDER, mimeType: 'image/jpeg' },
      ],
    })
  })

  it('deduplicates the same image in content and structuredContent', () => {
    const data = 'sharedScreenshotPayload'
    const block = { type: 'image', data, mimeType: PNG }
    const input = {
      content: [block],
      structuredContent: { ...block },
    }

    const { images, result, redacted } = liftMcpToolImages({
      result: input,
      source: SOURCE,
    })

    expect(redacted).toBe(1)
    expect(images).toHaveLength(1)
    expect(images[0]).toEqual({
      dataUrl: `data:${PNG};base64,${data}`,
      mediaType: PNG,
      source: SOURCE,
    })
    expect(result).toEqual({
      content: [{ type: 'image', data: PLACEHOLDER, mimeType: PNG }],
      structuredContent: { type: 'image', data: PLACEHOLDER, mimeType: PNG },
    })
    expect(JSON.stringify(result)).not.toContain(data)
  })

  it('returns a text-only result unchanged', () => {
    const input = {
      content: [{ type: 'text', text: 'hello' }],
      isError: false,
    }

    const { images, result, redacted } = liftMcpToolImages({
      result: input,
      source: SOURCE,
    })

    expect(redacted).toBe(0)
    expect(images).toEqual([])
    expect(JSON.stringify(result)).toBe(JSON.stringify(input))
  })

  it('replaces bytes when mimeType is missing and does not stage', () => {
    const data = 'rawBytesWithoutMime'
    const input = {
      content: [{ type: 'image', data }],
    }

    const { images, result, redacted } = liftMcpToolImages({
      result: input,
      source: SOURCE,
    })

    expect(redacted).toBe(1)
    expect(images).toEqual([])
    expect(result).toEqual({
      content: [{ type: 'image', data: PLACEHOLDER }],
    })
    expect(JSON.stringify(result)).not.toContain(data)
  })

  it('keeps long and non-ASCII payloads in the staged dataUrl only', () => {
    const data = `${'A'.repeat(8000)}/+✅日本語`
    const input = {
      content: [{ type: 'image', data, mimeType: PNG }],
    }

    const { images, result, redacted } = liftMcpToolImages({
      result: input,
      source: SOURCE,
    })

    expect(redacted).toBe(1)
    expect(images).toHaveLength(1)
    expect(images[0]!.dataUrl).toBe(`data:${PNG};base64,${data}`)
    expect(images[0]!.dataUrl.endsWith(data)).toBe(true)
    expect(JSON.stringify(result)).not.toContain(data)
    expect(JSON.stringify(result)).not.toContain('✅')
  })
})
