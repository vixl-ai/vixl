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
 * ask 3227, plan 3777, agent 4590, orchestrator 4066.
 * Headroom is about 3 percent so waste cannot return unnoticed.
 */
const TOTAL_CEILINGS: Record<VixlChatMode, number> = {
  ask: 3324,
  plan: 3891,
  agent: 4728,
  orchestrator: 4188,
}

/** Measured base tokens: ask 229, plan 289, agent 213, orchestrator 356. */
const BASE_CEILINGS: Record<VixlChatMode, number> = {
  ask: 236,
  plan: 298,
  agent: 220,
  orchestrator: 367,
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
 * ask 2929, plan 3419, agent 4308, orchestrator 3641.
 * Ceilings are measured plus about 3 percent.
 */
const TOOL_DEF_CEILINGS: Record<VixlChatMode, number> = {
  ask: 3017,
  plan: 3522,
  agent: 4437,
  orchestrator: 3750,
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
