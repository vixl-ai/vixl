import { describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri())

import assembleSystemPromptParts from '@/services/context/system-prompt-parts/assemble'

const input = (mode: 'ask' | 'plan' | 'agent' | 'studio' | 'orchestrator') => ({
  mode,
  projectName: 'vixl',
  projectRoot: '/tmp/vixl',
  mentions: [],
  agentCatalog: [],
  standalone: true,
})

describe('assemble system prompt parts', () => {
  it('replaces the prose tool catalog with a one-line hint', async () => {
    const parts = await assembleSystemPromptParts(input('ask'))
    expect(parts.tools).toBe(
      'Tools are provided as function calls; do not grep the repo for them.',
    )
    expect(parts.tools).not.toContain('Available tools in')
    expect(parts.base).not.toContain('- read_file:')
  })

  it('includes MCP but not shell, patch, or embedded browser guidance for ask and plan', async () => {
    for (const mode of ['ask', 'plan'] as const) {
      const parts = await assembleSystemPromptParts(input(mode))
      expect(parts.base).toContain('get_mcp_tools if stale')
      expect(parts.base).not.toContain('browser_lock')
      expect(parts.base).not.toContain('run_terminal only')
      expect(parts.base).not.toContain('apply_patch is OpenCode-style')
    }
  })

  it('includes allowlisted tool guidance for agent', async () => {
    const parts = await assembleSystemPromptParts(input('agent'))
    expect(parts.base).not.toContain('browser_lock')
    expect(parts.base).toContain('run_terminal only')
    expect(parts.base).toContain('get_mcp_tools if stale')
    expect(parts.base).toContain('apply_patch is OpenCode-style')
  })

  it('includes MCP and shell but not patch or embedded browser for studio', async () => {
    const parts = await assembleSystemPromptParts(input('studio'))
    expect(parts.base).toContain('get_mcp_tools if stale')
    expect(parts.base).toContain('run_terminal only')
    expect(parts.base).not.toContain('browser_lock')
    expect(parts.base).not.toContain('apply_patch is OpenCode-style')
  })

  it('keeps studio block catalog out of the always-on base', async () => {
    const parts = await assembleSystemPromptParts(input('studio'))
    expect(parts.base).toContain('load_skill("studio-blocks")')
    expect(parts.base).not.toContain('::page-header')
    expect(parts.skills).toContain('studio-blocks')
  })
})
