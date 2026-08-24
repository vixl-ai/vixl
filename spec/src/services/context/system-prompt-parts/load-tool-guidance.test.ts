import { describe, expect, it } from 'vitest'
import loadToolGuidanceForMode from '@/services/context/system-prompt-parts/load-tool-guidance'

describe('loadToolGuidanceForMode', () => {
  it('always includes shared codebase and LSP guidance', () => {
    const ask = loadToolGuidanceForMode('ask')
    expect(ask).toContain('codebase_explore')
    expect(ask).toContain('function calls')
  })

  it('includes browser guidance in all modes', () => {
    expect(loadToolGuidanceForMode('ask')).toContain('browser_lock')
    expect(loadToolGuidanceForMode('plan')).toContain('browser_lock')
    expect(loadToolGuidanceForMode('studio')).toContain('browser_lock')
    expect(loadToolGuidanceForMode('agent')).toContain('browser_lock')
    expect(loadToolGuidanceForMode('orchestrator')).toContain('browser_lock')
  })
})
