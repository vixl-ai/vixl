import { describe, expect, it } from 'vitest'
import loadToolGuidanceForMode from '@/services/context/system-prompt-parts/load-tool-guidance'

describe('loadToolGuidanceForMode', () => {
  it('always includes shared codebase and LSP guidance', () => {
    const ask = loadToolGuidanceForMode()
    expect(ask).toContain('codebase_explore')
    expect(ask).toContain('lsp')
  })

  it('loads tool-guidance.md and omits embedded browser and patch', () => {
    const text = loadToolGuidanceForMode()
    expect(text).toContain('codebase_explore')
    expect(text).toContain('progressive discovery')
    expect(text).toContain('get_mcp_tools (pass serverId) or get_mcp_tool, then call_mcp_tool')
    expect(text).not.toContain('browser_lock')
    expect(text).not.toContain('browser_cdp')
    expect(text).not.toContain('apply_patch')
  })
})
