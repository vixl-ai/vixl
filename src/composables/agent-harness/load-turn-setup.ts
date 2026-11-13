import { listAgentIndex } from '@/services/agents/registry'
import { loadEffectiveSettings } from '@/services/config/vixl-config'
import { listSlashSkillIndex } from '@/services/skills/skill-registry'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

export type TurnSetup =
  | {
      ok: true
      settings: VixlSettings
      agentIndex: Awaited<ReturnType<typeof listAgentIndex>>
      skillNames: string[]
    }
  | { ok: false; error: unknown }

// Turn setup loads settings, the agent catalog, and the skill index
// concurrently; they are independent and were serializing turn start.
export default async (
  settingsRoot: string | null,
  catalogRoot: string | null,
): Promise<TurnSetup> => {
  const [settingsOutcome, agentIndex, skillIndex] = await Promise.all([
    loadEffectiveSettings(settingsRoot).then(
      (settings) => ({ settings }) as const,
      (error) => ({ error }) as const,
    ),
    listAgentIndex(catalogRoot).catch(() => []),
    listSlashSkillIndex(catalogRoot).catch(() => []),
  ])
  if ('error' in settingsOutcome) {
    return { ok: false, error: settingsOutcome.error }
  }
  return {
    ok: true,
    settings: settingsOutcome.settings,
    agentIndex,
    skillNames: skillIndex.map((skill) => skill.name),
  }
}
