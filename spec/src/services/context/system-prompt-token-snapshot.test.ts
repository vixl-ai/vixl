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

const TOOLS_HINT = 'Tools are function calls, not repo code.'

const MODES: VixlChatMode[] = ['ask', 'plan', 'agent', 'orchestrator']

/**
 * Empty-project (standalone, no rules, no MCP) ceilings after slim prompts
 * and builtin tool descriptions.
 * Measured totals (system join + builtin tool defs, chars/4):
 * ask 3685, plan 4254, agent 5334, orchestrator 4708.
 * Headroom is about 3 percent so waste cannot return unnoticed.
 */
const TOTAL_CEILINGS: Record<VixlChatMode, number> = {
  ask: 3796,
  plan: 4382,
  agent: 5494,
  orchestrator: 4849,
}

/** Measured base tokens: ask 260, plan 320, agent 279, orchestrator 467. */
const BASE_CEILINGS: Record<VixlChatMode, number> = {
  ask: 268,
  plan: 330,
  agent: 288,
  orchestrator: 482,
}

/** Available skills catalog with ungated command skills; measured 59. */
const SKILLS_CEILINGS: Record<VixlChatMode, number> = {
  ask: 61,
  plan: 61,
  agent: 61,
  orchestrator: 61,
}

/**
 * Measured builtin tool-def tokens (chars/4):
 * ask 3355, plan 3864, agent 4986, orchestrator 4220.
 * Ceilings are measured plus about 3 percent.
 */
const TOOL_DEF_CEILINGS: Record<VixlChatMode, number> = {
  ask: 3456,
  plan: 3980,
  agent: 5136,
  orchestrator: 4347,
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

  it('orders ask below plan below agent by total tokens', async () => {
    const ask = await measureMode('ask')
    const plan = await measureMode('plan')
    const agent = await measureMode('agent')
    expect(ask.total).toBeLessThan(plan.total)
    expect(plan.total).toBeLessThan(agent.total)
  })

  it('includes shared tool guidance and omits patch and embedded browser from ask', async () => {
    const snapshot = await measureMode('ask')
    expect(snapshot.systemString).toContain('codebase_explore')
    expect(snapshot.systemString).toContain('progressive discovery')
    expect(snapshot.systemString).toContain('get_mcp_tools')
    expect(snapshot.systemString).not.toContain('browser_cdp')
    expect(snapshot.systemString).not.toContain('browser_lock')
    expect(snapshot.systemString).not.toContain('apply_patch')
  })
})
