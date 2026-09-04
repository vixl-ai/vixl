import { describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri())

import assembleSystemPromptParts, {
  joinSystemPromptParts,
  type SystemPromptParts,
} from '@/services/context/system-prompt-parts'
import estimateBuiltinToolDefinitionTokens from '@/services/context/estimate-builtin-tool-definition-tokens'
import estimateTextTokens from '@/utils/estimate-text-tokens'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'

const TOOLS_HINT =
  'Tools are provided as function calls; do not grep the repo for them.'

const MODES: VixlChatMode[] = ['ask', 'plan', 'studio', 'agent', 'orchestrator']

/**
 * Empty-project (standalone, no rules, no MCP) ceilings after dropping embedded browser tools.
 * Measured totals (system join + builtin tool defs, chars/4):
 * ask 4328, plan 4899, studio 5112, agent 6247, orchestrator 4653.
 * Headroom is about 3 percent so waste cannot return unnoticed.
 */
const TOTAL_CEILINGS: Record<VixlChatMode, number> = {
  ask: 4460,
  plan: 5050,
  studio: 5270,
  agent: 6440,
  orchestrator: 4800,
}

const BASE_CEILINGS: Record<VixlChatMode, number> = {
  ask: 820,
  plan: 885,
  studio: 890,
  agent: 1090,
  orchestrator: 965,
}

const SKILLS_CEILINGS: Record<VixlChatMode, number> = {
  ask: 50,
  plan: 50,
  studio: 80,
  agent: 25,
  orchestrator: 25,
}

const TOOL_DEF_CEILINGS: Record<VixlChatMode, number> = {
  ask: 3590,
  plan: 4100,
  studio: 4290,
  agent: 5310,
  orchestrator: 3790,
}

type ModeSnapshot = {
  mode: VixlChatMode
  parts: SystemPromptParts
  systemString: string
  base: number
  tools: number
  skills: number
  system: number
  toolDefs: number
  total: number
}

const measureMode = async (mode: VixlChatMode): Promise<ModeSnapshot> => {
  const parts = await assembleSystemPromptParts({
    mode,
    projectName: 'empty',
    projectRoot: '/tmp/empty-vixl',
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
    'keeps %s system plus builtin tool-def tokens under capability-model ceilings',
    async (mode) => {
      const snapshot = await measureMode(mode)
      expect(snapshot.parts.tools).toBe(TOOLS_HINT)
      expect(snapshot.parts.tools).not.toContain('Available tools in')
      expect(snapshot.parts.mcp).toBe('')
      expect(snapshot.parts.agentsMd).toBe('')
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

  it('includes MCP and shell guidance but omits patch and embedded browser from ask', async () => {
    const snapshot = await measureMode('ask')
    expect(snapshot.systemString).toContain('get_mcp_tools if stale')
    expect(snapshot.systemString).toContain('run_terminal only')
    expect(snapshot.systemString).not.toContain('browser_cdp')
    expect(snapshot.systemString).not.toContain('browser_lock')
    expect(snapshot.systemString).not.toContain('apply_patch')
  })

  it('keeps the Comark block catalog out of the always-on studio skill', async () => {
    const snapshot = await measureMode('studio')
    expect(snapshot.parts.base).toContain('load_skill("studio-blocks")')
    expect(snapshot.parts.base).not.toContain('::chart')
    expect(snapshot.parts.base).not.toContain('::page-header')
    expect(snapshot.parts.skills).toContain('studio-blocks')
  })
})
