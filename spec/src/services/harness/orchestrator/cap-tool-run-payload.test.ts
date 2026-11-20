import { describe, expect, it } from 'vitest'
import capToolRunPayload from '@/services/harness/orchestrator/cap-tool-run-payload'
import { TERMINAL_OUTPUT_MAX_CHARS } from '@/utils/clip-terminal-output'

describe('capToolRunPayload', () => {
  it('passes primitives through unchanged', () => {
    expect(capToolRunPayload(undefined)).toBeUndefined()
    expect(capToolRunPayload(null)).toBeNull()
    expect(capToolRunPayload(42)).toBe(42)
    expect(capToolRunPayload(true)).toBe(true)
    expect(capToolRunPayload('short')).toBe('short')
  })

  it('clips an oversized error string and keeps the tail', () => {
    const error = `Command failed (2): ${'e'.repeat(400_000)}\nError: build failed`
    const capped = capToolRunPayload(error) as string

    expect(capped.length).toBeLessThanOrEqual(TERMINAL_OUTPUT_MAX_CHARS)
    expect(capped).toContain('[output clipped:')
    expect(capped).toContain('Error: build failed')
  })

  it('clips long strings nested in objects and arrays, preserving shape', () => {
    const payload = {
      shellId: 'shell-1',
      exitCode: 2,
      stdout: 'ok',
      stderr: 'x'.repeat(100_000),
      nested: [{ output: 'y'.repeat(100_000) }],
    }
    const capped = capToolRunPayload(payload) as typeof payload

    expect(capped.shellId).toBe('shell-1')
    expect(capped.exitCode).toBe(2)
    expect(capped.stdout).toBe('ok')
    expect(capped.stderr.length).toBeLessThanOrEqual(TERMINAL_OUTPUT_MAX_CHARS)
    expect(capped.nested[0]!.output.length).toBeLessThanOrEqual(TERMINAL_OUTPUT_MAX_CHARS)
  })

  it('is idempotent', () => {
    const payload = { error: 'z'.repeat(400_000) }
    const once = capToolRunPayload(payload)
    expect(capToolRunPayload(once)).toEqual(once)
  })

  it('does not mutate the input payload', () => {
    const payload = { error: 'q'.repeat(100_000) }
    capToolRunPayload(payload)
    expect(payload.error.length).toBe(100_000)
  })
})