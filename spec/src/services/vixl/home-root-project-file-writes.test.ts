import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import { HOME_PROJECT_SCOPE_ERROR } from '@/services/config/is-home-workspace-root'

const { fsWriteFile, getVixlDir, getUserHomeDir } = vi.hoisted(() => ({
  fsWriteFile: vi.fn<
    (args: { projectRoot: string; path: string; content: string }) => Promise<unknown>
  >(async () => undefined),
  getVixlDir: vi.fn<(scope: string) => Promise<string>>(async () => '/home/user/.vixl'),
  getUserHomeDir: vi.fn<() => Promise<string>>(async () => '/Users/test-home'),
}))

vi.mock('@/services/vixl/vixl-tauri/home-dir', () => ({
  getUserHomeDir,
}))

vi.mock('@/services/vixl/vixl-tauri/helpers', async () => {
  const { createHomeWorkspaceHelpersMock } = await import(
    '../../test-utils/mocks/home-workspace-command'
  )
  return createHomeWorkspaceHelpersMock(getUserHomeDir)
})

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    fsWriteFile,
    getVixlDir,
  }),
)

import writeAgent from '@/services/agents/write-agent'
import writeAgentsMd from '@/services/agents-md/write-agents-md'
import writeRule from '@/services/rules/write-rule'
import writeSkill from '@/services/skills/write-skill'

const homeRoot = '/Users/test-home'
const projectRoot = '/tmp/proj'
const personalDir = '/home/user/.vixl'

beforeEach(() => {
  fsWriteFile.mockReset()
  getVixlDir.mockReset()
  getUserHomeDir.mockReset()
  fsWriteFile.mockResolvedValue(undefined)
  getVixlDir.mockResolvedValue(personalDir)
  getUserHomeDir.mockResolvedValue(`${homeRoot}/`)
})

describe('project-scoped vixl file writes on the home directory', () => {
  it('refuses skill, rule, agent, and AGENTS.md writes for the home directory', async () => {
    await expect(
      writeSkill({
        scope: 'project',
        projectRoot: homeRoot,
        name: 'Deploy',
        description: 'Ship the app',
        body: 'steps',
      }),
    ).rejects.toThrow(HOME_PROJECT_SCOPE_ERROR)
    await expect(
      writeRule({
        scope: 'project',
        projectRoot: `${homeRoot}/`,
        name: 'Lint',
        body: 'keep it short',
      }),
    ).rejects.toThrow(HOME_PROJECT_SCOPE_ERROR)
    await expect(
      writeAgent({
        scope: 'project',
        projectRoot: homeRoot,
        name: 'Reviewer',
        description: 'Review diffs',
        body: 'focus on tests',
      }),
    ).rejects.toThrow(HOME_PROJECT_SCOPE_ERROR)
    await expect(
      writeAgentsMd({ scope: 'project', projectRoot: `${homeRoot}/` }),
    ).rejects.toThrow(HOME_PROJECT_SCOPE_ERROR)

    expect(fsWriteFile).not.toHaveBeenCalled()
    expect(getVixlDir).not.toHaveBeenCalled()
  })

  it('still writes project files for a real project root', async () => {
    const skill = await writeSkill({
      scope: 'project',
      projectRoot,
      name: 'Deploy',
      description: 'Ship the app',
      body: 'steps',
    })
    const rule = await writeRule({
      scope: 'project',
      projectRoot,
      name: 'Lint',
      body: 'keep it short',
    })
    const agent = await writeAgent({
      scope: 'project',
      projectRoot,
      name: 'Reviewer',
      description: 'Review diffs',
      body: 'focus on tests',
    })
    const agentsMd = await writeAgentsMd({ scope: 'project', projectRoot })

    expect(skill).toEqual({ slug: 'deploy', path: '.vixl/skills/deploy/SKILL.md' })
    expect(rule).toEqual({ slug: 'lint', path: '.vixl/rules/lint.md' })
    expect(agent).toEqual({ slug: 'reviewer', path: '.vixl/agents/reviewer.md' })
    expect(agentsMd).toEqual({ path: '.vixl/AGENTS.md' })
    expect(fsWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot,
        path: '.vixl/skills/deploy/SKILL.md',
      }),
    )
    expect(fsWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot,
        path: '.vixl/rules/lint.md',
      }),
    )
    expect(fsWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot,
        path: '.vixl/agents/reviewer.md',
      }),
    )
    expect(fsWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot,
        path: '.vixl/AGENTS.md',
      }),
    )
    expect(getVixlDir).not.toHaveBeenCalled()
  })

  it('still writes personal files when the home directory is passed as projectRoot', async () => {
    const skill = await writeSkill({
      scope: 'personal',
      projectRoot: homeRoot,
      name: 'Deploy',
      description: 'Ship the app',
      body: 'steps',
    })
    const rule = await writeRule({
      scope: 'personal',
      projectRoot: homeRoot,
      name: 'Lint',
      body: 'keep it short',
    })
    const agent = await writeAgent({
      scope: 'personal',
      projectRoot: homeRoot,
      name: 'Reviewer',
      description: 'Review diffs',
      body: 'focus on tests',
    })
    const agentsMd = await writeAgentsMd({
      scope: 'personal',
      projectRoot: homeRoot,
    })

    expect(skill.path).toBe('skills/deploy/SKILL.md')
    expect(rule.path).toBe('rules/lint.md')
    expect(agent.path).toBe('agents/reviewer.md')
    expect(agentsMd.path).toBe('AGENTS.md')
    expect(getVixlDir).toHaveBeenCalledWith('personal')
    expect(fsWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: personalDir,
        path: 'skills/deploy/SKILL.md',
      }),
    )
    expect(fsWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: personalDir,
        path: 'rules/lint.md',
      }),
    )
    expect(fsWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: personalDir,
        path: 'agents/reviewer.md',
      }),
    )
    expect(fsWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: personalDir,
        path: 'AGENTS.md',
      }),
    )
  })
})
