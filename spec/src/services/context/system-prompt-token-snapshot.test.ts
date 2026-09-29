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

const TOOLS_HINT = 'Tools are provided as function calls; do not grep the repo for them.'

const MODES: VixlChatMode[] = ['ask', 'plan', 'agent', 'orchestrator']

/**
 * Empty-project (standalone, no rules, no MCP) ceilings after slim prompts
 * and builtin tool descriptions.
 * Measured totals (system join + builtin tool defs, chars/4):
 * ask 3386, plan 3969, agent 4846, orchestrator 4311.
 * Headroom is about 3 percent so waste cannot return unnoticed.
 */
const TOTAL_CEILINGS: Record<VixlChatMode, number> = {
  ask: 3488,
  plan: 4089,
  agent: 4992,
  orchestrator: 4441,
}

const BASE_CEILINGS: Record<VixlChatMode, number> = {
  ask: 290,
  plan: 337,
  agent: 270,
  orchestrator: 418,
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
 * ask 3067, plan 3597, agent 4543, orchestrator 3828.
 * Agent stays measured plus one. Ask, plan, and orchestrator are measured
 * plus about 3 percent after the spawn capabilities describe change.
 */
const TOOL_DEF_CEILINGS: Record<VixlChatMode, number> = {
  ask: 3160,
  plan: 3705,
  agent: 4544,
  orchestrator: 3943,
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
    expect(snapshot.systemString).not.toContain('browser_cdp')
    expect(snapshot.systemString).not.toContain('browser_lock')
    expect(snapshot.systemString).not.toContain('apply_patch')
  })
})
