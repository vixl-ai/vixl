import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import rawToolPayload from '@/utils/raw-tool-payload'

describe('raw-tool-payload', () => {
  it('marks objects so reactive() skips proxying', () => {
    const payload = rawToolPayload({ path: 'src/a.ts', content: 'x' })
    expect(reactive(payload)).toBe(payload)
  })

  it('marks arrays so reactive() skips proxying', () => {
    const diffs = rawToolPayload([{ path: 'src/a.ts', hunks: [] }])
    expect(reactive(diffs)).toBe(diffs)
  })

  it('passes primitives and nullish values through unchanged', () => {
    expect(rawToolPayload('text')).toBe('text')
    expect(rawToolPayload(42)).toBe(42)
    expect(rawToolPayload(undefined)).toBeUndefined()
    expect(rawToolPayload(null)).toBeNull()
  })
})