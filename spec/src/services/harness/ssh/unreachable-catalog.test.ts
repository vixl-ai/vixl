import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri())

vi.mock('@/services/config/is-home-workspace-root', () => ({
  HOME_PROJECT_SCOPE_ERROR: 'Refusing project-scope changes for the home directory',
  isHomeWorkspaceRoot: async () => false,
}))

import assembleSystemPromptParts from '@/services/context/system-prompt-parts/assemble'
import loadAgentsMdBlock from '@/services/context/system-prompt-parts/load-agents-md-block'
import { listAgentIndex } from '@/services/agents/registry'
import { loadSkillForWorkspace } from '@/services/harness/skill/resolve-member-skill'
import { discoverProjectSkillIndex } from '@/services/skills/discover-project-skills'
import { listSkillIndex, listSlashSkillIndex } from '@/services/skills/skill-registry'
import { fsReadFile, listVixlFiles } from '@/services/vixl/vixl-tauri'

const sshRoot = 'ssh://aidanhibbard@eva.local/home/aidanhibbard/proj'
const unreachable = new Error('eva.local is unreachable.')

describe('unreachable ssh project catalogs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listVixlFiles).mockImplementation(async (scope) => {
      if (scope === 'personal') {
        return []
      }
      throw unreachable
    })
    vi.mocked(fsReadFile).mockRejectedValue(unreachable)
  })

  it('does not turn eva.local is unreachable. into an empty skill, agent, rule, or AGENTS.md result', async () => {
    await expect(discoverProjectSkillIndex(sshRoot)).rejects.toThrow(
      'eva.local is unreachable.',
    )
    await expect(listSkillIndex('agent', sshRoot)).rejects.toThrow(
      'eva.local is unreachable.',
    )
    await expect(listSlashSkillIndex(sshRoot)).rejects.toThrow(
      'eva.local is unreachable.',
    )
    await expect(listAgentIndex(sshRoot)).rejects.toThrow('eva.local is unreachable.')
    await expect(
      loadAgentsMdBlock({ projectRoot: sshRoot, standalone: false }),
    ).rejects.toThrow('eva.local is unreachable.')
    await expect(
      assembleSystemPromptParts({
        mode: 'agent',
        projectName: 'proj',
        projectRoot: sshRoot,
        mentions: [],
        agentCatalog: [{ name: 'helper', description: 'local stand-in' }],
        standalone: false,
      }),
    ).rejects.toThrow('eva.local is unreachable.')
    await expect(
      loadSkillForWorkspace('deploy', sshRoot, [
        { slug: 'eva', name: 'Eva', rootPath: sshRoot },
        {
          slug: 'other',
          name: 'Other',
          rootPath: 'ssh://aidanhibbard@eva.local/home/aidanhibbard/other',
        },
      ]),
    ).rejects.toThrow('eva.local is unreachable.')
  })
})
