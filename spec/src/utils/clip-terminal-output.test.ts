import { describe, expect, it } from 'vitest'
import { clipTerminalOutput, TERMINAL_OUTPUT_MAX_CHARS } from '@/utils/clip-terminal-output'

describe('clipTerminalOutput', () => {
  it('returns short text unchanged', () => {
    expect(clipTerminalOutput('hello\n')).toBe('hello\n')
  })

  it('returns text at the cap unchanged', () => {
    const text = 'x'.repeat(TERMINAL_OUTPUT_MAX_CHARS)
    expect(clipTerminalOutput(text)).toBe(text)
  })

  it('clips oversized text to a head and tail window with the exact dropped count', () => {
    const text = `${'a'.repeat(100_000)}\ntail-marker\n`
    const clipped = clipTerminalOutput(text)

    expect(clipped.length).toBeLessThanOrEqual(TERMINAL_OUTPUT_MAX_CHARS)
    expect(clipped.startsWith('a')).toBe(true)
    expect(clipped).toContain('[output clipped: 68063 chars omitted]')
    expect(clipped).toContain('tail-marker')
  })

  it('is idempotent so layered clipping keeps the tail and the dropped count', () => {
    const text = `${'b'.repeat(500_000)}\nError: build failed\n`
    const once = clipTerminalOutput(text)

    expect(clipTerminalOutput(once)).toBe(once)
    expect(once).toContain('Error: build failed')
  })

  it('passes an already-clipped composition through unchanged within the slack', () => {
    const clipped = clipTerminalOutput('a'.repeat(400_000))
    const composed = `$ npm run ci\n${clipped}\n\nHint: check stderr before retrying`

    expect(composed.length).toBeGreaterThan(TERMINAL_OUTPUT_MAX_CHARS)
    expect(clipTerminalOutput(composed)).toBe(composed)
  })

  it('re-clips marker text that exceeds the slack so the count stays honest', () => {
    const clipped = clipTerminalOutput('a'.repeat(400_000))
    const composed = `${clipped}${'noise'.repeat(10_000)}`
    const result = clipTerminalOutput(composed)

    expect(result.length).toBeLessThanOrEqual(TERMINAL_OUTPUT_MAX_CHARS)
    expect(result).toContain('[output clipped:')
    expect(result).toContain('noise')
  })
})
