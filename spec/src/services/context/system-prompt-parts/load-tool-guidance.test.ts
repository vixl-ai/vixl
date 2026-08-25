import { describe, expect, it } from 'vitest'
import loadToolGuidanceForMode from '@/services/context/system-prompt-parts/load-tool-guidance'

describe('loadToolGuidanceForMode', () => {
  it('always includes shared codebase and LSP guidance', () => {
    const ask = loadToolGuidanceForMode('ask')
    expect(ask).toContain('codebase_explore')
    expect(ask).toContain('function calls')
  })

  it('includes MCP guidance in all modes and omits embedded browser guidance', () => {
    for (const mode of ['ask', 'plan', 'studio', 'agent', 'orchestrator'] as const) {
      const text = loadToolGuidanceForMode(mode)
      expect(text).toContain('get_mcp_tools if stale')
      expect(text).not.toContain('browser_lock')
      expect(text).not.toContain('browser_cdp')
    }
  })
})
