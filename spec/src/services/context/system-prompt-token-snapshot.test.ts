import { describe, expect, it, vi } from 'vitest'
import { mockPyrolaTauri } from '../../test-utils/mocks/pyrola-tauri'

vi.mock('@/services/pyrola/pyrola-tauri', () => mockPyrolaTauri())

import assembleSystemPromptParts, {
  joinSystemPromptParts,
  type SystemPromptParts,
} from '@/services/context/system-prompt-parts'
import estimateBuiltinToolDefinitionTokens from '@/services/context/estimate-builtin-tool-definition-tokens'
import estimateTextTokens from '@/utils/estimate-text-tokens'
import type { PyrolaChatMode } from '@/types/pyrola/pyrola-settings'

const TOOLS_HINT =
  'Tools are provided as function calls; do not grep the repo for them.'

const MODES: PyrolaChatMode[] = ['ask', 'plan', 'studio', 'agent', 'orchestrator']

/**
 * Empty-project (standalone, no rules, no MCP) ceilings after Slice 1 trims.
 * Measured totals (system join + builtin tool defs, chars/4):
 * ask 2368, plan 2916, studio 4329, agent 10532, orchestrator 8937.
 * Headroom is about 3 percent so waste cannot return unnoticed.
 */
const TOTAL_CEILINGS: Record<PyrolaChatMode, number> = {
  ask: 2450,
  plan: 3000,
  studio: 4450,
  agent: 10600,
  orchestrator: 9000,
}

const BASE_CEILINGS: Record<PyrolaChatMode, number> = {
  ask: 610,
  plan: 680,
  studio: 780,
  agent: 1460,
  orchestrator: 1320,
}

const SKILLS_CEILINGS: Record<PyrolaChatMode, number> = {
  ask: 40,
  plan: 30,
  studio: 90,
  agent: 35,
  orchestrator: 35,
}

const TOOL_DEF_CEILINGS: Record<PyrolaChatMode, number> = {
  ask: 1800,
  plan: 2300,
  studio: 3600,
  agent: 9150,
  orchestrator: 7700,
}

type ModeSnapshot = {
  mode: PyrolaChatMode
  parts: SystemPromptParts
  systemString: string
  base: number
  tools: number
  skills: number
  system: number
  toolDefs: number
  total: number
}

const measureMode = async (mode: PyrolaChatMode): Promise<ModeSnapshot> => {
  const parts = await assembleSystemPromptParts({
    mode,
    projectName: 'empty',
    projectRoot: '/tmp/empty-pyrola',
    mentions: [],
    agentCatalog: [],
    standalone: true,
  })
  const systemString = joinSystemPromptParts(parts)
  const system = estimateTextTokens(systemString)
  const toolDefs = estimateBuiltinToolDefinitionTokens(mode)
  return {
    mode,
    parts,
    systemString,
    base: estimateTextTokens(parts.base),
    tools: estimateTextTokens(parts.tools),
    skills: estimateTextTokens(parts.skills),
    system,
    toolDefs,
    total: system + toolDefs,
  }
}

describe('system prompt token snapshot (empty project)', () => {
  it.each(MODES)(
    'keeps %s system plus builtin tool-def tokens under Slice 1 ceilings',
    async (mode) => {
      const snapshot = await measureMode(mode)
      expect(snapshot.parts.tools).toBe(TOOLS_HINT)
      expect(snapshot.parts.tools).not.toContain('Available tools in')
      expect(snapshot.parts.mcp).toBe('')
      expect(snapshot.parts.rules).toBe('')
      expect(snapshot.parts.subagents).toBe('')
      expect(snapshot.parts.mentions).toBe('')
      expect(snapshot.tools).toBeLessThan(20)
      expect(snapshot.base).toBeLessThan(BASE_CEILINGS[mode])
      expect(snapshot.skills).toBeLessThan(SKILLS_CEILINGS[mode])
      expect(snapshot.toolDefs).toBeLessThan(TOOL_DEF_CEILINGS[mode])
      expect(snapshot.total).toBeLessThan(TOTAL_CEILINGS[mode])
    },
  )

  it('orders ask below studio below agent by total tokens', async () => {
    const ask = await measureMode('ask')
    const studio = await measureMode('studio')
    const agent = await measureMode('agent')
    expect(ask.total).toBeLessThan(studio.total)
    expect(studio.total).toBeLessThan(agent.total)
  })

  it('omits browser CDP, apply_patch, and shell guidance from ask', async () => {
    const snapshot = await measureMode('ask')
    expect(snapshot.systemString).not.toContain('browser_cdp')
    expect(snapshot.systemString).not.toContain('apply_patch')
    expect(snapshot.systemString).not.toContain('run_terminal only')
  })

  it('keeps the Comark block catalog out of the always-on studio skill', async () => {
    const snapshot = await measureMode('studio')
    expect(snapshot.parts.base).toContain('load_skill("studio-blocks")')
    expect(snapshot.parts.base).not.toContain('::chart')
    expect(snapshot.parts.base).not.toContain('::page-header')
    expect(snapshot.parts.skills).toContain('studio-blocks')
  })
})
