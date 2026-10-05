import { describe, expect, it } from 'vitest'
import appendStreamText, { MAX_STREAM_CHARS } from '@/services/harness/shell/append-stream-text'

describe('appendStreamText', () => {
  it('appends under the cap', () => {
    expect(appendStreamText('abc', 'def')).toBe('abcdef')
  })

  it('trims a giant single chunk to the tail cap', () => {
    const appended = appendStreamText('', 'z'.repeat(MAX_STREAM_CHARS * 3))

    expect(appended.length).toBe(MAX_STREAM_CHARS)
    expect(appended.startsWith('z')).toBe(true)
  })

  it('keeps the buffer bounded across many appends', () => {
    let buffer = ''
    const chunk = 'y'.repeat(50_000)
    for (let index = 0; index < 100; index += 1) {
      buffer = appendStreamText(buffer, chunk)
    }

    expect(buffer.length).toBeLessThanOrEqual(MAX_STREAM_CHARS * 2)
    expect(buffer.length).toBeGreaterThan(0)
    expect(buffer.startsWith('y')).toBe(true)
  })
})
