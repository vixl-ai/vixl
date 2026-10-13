import { describe, expect, it } from 'vitest'
import truncateToolResult from '@/utils/truncate-tool-result'

describe('truncate-tool-result', () => {
  it('returns non-objects unchanged', () => {
    expect(truncateToolResult('ok')).toBe('ok')
    expect(truncateToolResult(null)).toBeNull()
    expect(truncateToolResult(3)).toBe(3)
  })

  it('returns a plain string result as-is', () => {
    expect(truncateToolResult('hello')).toBe('hello')
  })

  it('strips imageParts from object results', () => {
    expect(
      truncateToolResult({
        summary: 'shot',
        imageParts: [{ data: 'abc' }],
        path: 'a.png',
      }),
    ).toEqual({ summary: 'shot', path: 'a.png' })
  })

  it('replaces MCP image block data with a placeholder', () => {
    const result = truncateToolResult({
      content: [{ type: 'image', data: 'QUJD', mimeType: 'image/png' }],
    })

    expect(result).toEqual({
      content: [
        {
          type: 'image',
          data: '[image loaded into context]',
          mimeType: 'image/png',
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain('QUJD')
  })

  it('strips both imageParts and MCP image blocks', () => {
    const result = truncateToolResult({
      imageParts: [{ data: 'abc' }],
      content: [{ type: 'image', data: 'QUJD', mimeType: 'image/png' }],
      path: 'a.png',
    })

    expect(result).toEqual({
      content: [
        {
          type: 'image',
          data: '[image loaded into context]',
          mimeType: 'image/png',
        },
      ],
      path: 'a.png',
    })
    expect(JSON.stringify(result)).not.toContain('QUJD')
    expect(JSON.stringify(result)).not.toContain('imageParts')
  })

  it('leaves a text-only object result unchanged', () => {
    expect(
      truncateToolResult({
        content: [{ type: 'text', text: 'hello' }],
      }),
    ).toEqual({
      content: [{ type: 'text', text: 'hello' }],
    })
  })
})
