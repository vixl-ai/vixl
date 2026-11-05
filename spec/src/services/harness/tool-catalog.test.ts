import { describe, expect, it } from 'vitest'
import { MODE_TOOL_ALLOWLIST } from '@/services/harness/mode-allowlists'
import { TOOL_DESCRIPTIONS } from '@/services/harness/tool-catalog'

const liveToolNames = [...new Set(Object.values(MODE_TOOL_ALLOWLIST).flat())].sort()

describe('TOOL_DESCRIPTIONS', () => {
  it('matches the union of mode allowlist tool names', () => {
    expect(Object.keys(TOOL_DESCRIPTIONS).sort()).toEqual(liveToolNames)
  })

  it('keeps every description to a single line of at most 120 characters', () => {
    for (const [name, description] of Object.entries(TOOL_DESCRIPTIONS)) {
      expect(description.includes('\n'), `${name} must be a single line`).toBe(false)
      expect(description.length, `${name} must be at most 120 characters`).toBeLessThanOrEqual(
        120,
      )
    }
  })
})
