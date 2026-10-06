import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import type { ProjectFileEntry } from '@/services/vixl/vixl-tauri'
import type { SkillIndexEntry } from '@/types/skills/skill'

const getUserHomeDir = vi.hoisted(() =>
  vi.fn<() => Promise<string>>(async () => '/Users/test-home'),
)

vi.mock('@/services/vixl/vixl-tauri/home-dir', () => ({
  getUserHomeDir,
}))

vi.mock('@/services/vixl/vixl-tauri/helpers', async () => {
  const { createHomeWorkspaceHelpersMock } = await import(
    '../../test-utils/mocks/home-workspace-command'
  )
  return createHomeWorkspaceHelpersMock(getUserHomeDir)
})

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri())

import {
  listSkillIndex,
  listSlashSkillIndex,
  listStandaloneSkillIndex,
  loadSkill,
} from '@/services/skills/skill-registry'
import { fsReadFile, listVixlFiles } from '@/services/vixl/vixl-tauri'

const projectA = '/tmp/project-a'
const projectB = '/tmp/project-b'
const modeSkillNames = ['ask', 'plan', 'agent', 'orchestrator'] as const
const commandSkillNames = ['create-agent', 'create-plan', 'create-rule', 'create-skill'] as const

const personalSkills: ProjectFileEntry[] = [
  { name: 'personal-notes', path: 'skills/personal-notes', description: 'User notes' },
]

const projectASkills: ProjectFileEntry[] = [
  { name: 'deploy-a', path: '.vixl/skills/deploy-a', description: 'Project A deploy' },
]

const projectBSkills: ProjectFileEntry[] = [
  { name: 'deploy-b', path: '.vixl/skills/deploy-b', description: 'Project B deploy' },
]

const hasSkill = (
  index: SkillIndexEntry[],
  name: string,
  scope?: SkillIndexEntry['scope'],
): boolean =>
  index.some(
    (skill) =>
      skill.name.toLowerCase() === name.toLowerCase() &&
      (scope === undefined || skill.scope === scope),
  )

const stubSkillDisks = (options: {
  personal?: ProjectFileEntry[]
  byProject?: Record<string, ProjectFileEntry[]>
}): void => {
  vi.mocked(listVixlFiles).mockImplementation(async (scope, kind, rootPath) => {
    if (kind !== 'skills') {
      return []
    }
    if (scope === 'personal') {
      return options.personal ?? []
    }
    if (scope === 'project' && rootPath) {
      return options.byProject?.[rootPath] ?? []
    }
    return []
  })
}

beforeEach(() => {
  vi.mocked(listVixlFiles).mockReset()
  vi.mocked(fsReadFile).mockReset()
  getUserHomeDir.mockReset()
  getUserHomeDir.mockResolvedValue('/Users/test-home')
  vi.mocked(fsReadFile).mockResolvedValue({
    path: '',
    content: '',
    totalLines: 0,
    offset: 0,
    limit: 0,
  })
  stubSkillDisks({
    personal: personalSkills,
    byProject: {
      [projectA]: projectASkills,
      [projectB]: projectBSkills,
    },
  })
})

describe('listSkillIndex', () => {
  it('unions personal skills with the current project skills', async () => {
    const index = await listSkillIndex('agent', projectA)

    expect(hasSkill(index, 'personal-notes', 'user')).toBe(true)
    expect(hasSkill(index, 'deploy-a', 'project')).toBe(true)
    expect(hasSkill(index, 'agent', 'internal')).toBe(true)
    for (const name of commandSkillNames) {
      expect(hasSkill(index, name, 'internal')).toBe(true)
    }
    expect(listVixlFiles).toHaveBeenCalledWith('personal', 'skills')
    expect(listVixlFiles).toHaveBeenCalledWith('project', 'skills', projectA)
  })

  it('does not include another project skills when the active root changes', async () => {
    const index = await listSkillIndex('agent', projectB)

    expect(hasSkill(index, 'personal-notes', 'user')).toBe(true)
    expect(hasSkill(index, 'deploy-b', 'project')).toBe(true)
    expect(hasSkill(index, 'deploy-a')).toBe(false)

    const projectCalls = vi
      .mocked(listVixlFiles)
      .mock.calls.filter((call) => call[0] === 'project' && call[1] === 'skills')
    expect(projectCalls).toEqual([['project', 'skills', projectB]])
  })

  it('lets a project skill win a case-insensitive name collision with a personal skill', async () => {
    stubSkillDisks({
      personal: [
        {
          name: 'shared-skill',
          path: 'skills/shared-skill',
          description: 'From personal',
        },
      ],
      byProject: {
        [projectA]: [
          {
            name: 'Shared-Skill',
            path: '.vixl/skills/Shared-Skill',
            description: 'From project',
          },
        ],
      },
    })

    const index = await listSkillIndex('agent', projectA)
    const shared = index.filter((skill) => skill.name.toLowerCase() === 'shared-skill')

    expect(shared).toHaveLength(1)
    expect(shared[0]).toEqual({
      name: 'Shared-Skill',
      description: 'From project',
      scope: 'project',
    })
  })

  it('keeps an internal command skill when a user or project skill uses the same name', async () => {
    stubSkillDisks({
      personal: [
        {
          name: 'create-rule',
          path: 'skills/create-rule',
          description: 'User create rule',
        },
      ],
      byProject: {
        [projectA]: [
          {
            name: 'Create-Rule',
            path: '.vixl/skills/Create-Rule',
            description: 'Project create rule',
          },
        ],
      },
    })

    const index = await listSkillIndex('agent', projectA)
    const matched = index.filter((skill) => skill.name.toLowerCase() === 'create-rule')

    expect(matched).toHaveLength(1)
    expect(matched[0]).toEqual({
      name: 'create-rule',
      description: 'Write a project rule under .vixl/rules.',
      scope: 'internal',
    })
  })
})

describe('listSlashSkillIndex', () => {
  it('unions personal skills with the current project skills and omits mode-gated internals', async () => {
    const index = await listSlashSkillIndex(projectA)

    expect(hasSkill(index, 'personal-notes', 'user')).toBe(true)
    expect(hasSkill(index, 'deploy-a', 'project')).toBe(true)
    for (const name of commandSkillNames) {
      expect(hasSkill(index, name, 'internal')).toBe(true)
    }
    for (const name of modeSkillNames) {
      expect(hasSkill(index, name)).toBe(false)
    }
    expect(listVixlFiles).toHaveBeenCalledWith('personal', 'skills')
    expect(listVixlFiles).toHaveBeenCalledWith('project', 'skills', projectA)
  })

  it('lists personal skills and skips a project scan when the root is the home directory', async () => {
    const homeRoot = '/Users/aidan/home'
    getUserHomeDir.mockResolvedValue(`${homeRoot}/`)
    stubSkillDisks({
      personal: personalSkills,
      byProject: {
        [homeRoot]: [
          {
            name: 'home-notes',
            path: '.vixl/skills/home-notes',
            description: 'Home workspace notes',
          },
          {
            name: 'create-agent',
            path: '.vixl/skills/create-agent',
            description: 'Shadow create agent',
          },
        ],
      },
    })

    const index = await listSlashSkillIndex(homeRoot)

    expect(hasSkill(index, 'personal-notes', 'user')).toBe(true)
    expect(hasSkill(index, 'home-notes')).toBe(false)
    for (const name of commandSkillNames) {
      expect(hasSkill(index, name, 'internal')).toBe(true)
    }
    const createAgent = index.filter((skill) => skill.name.toLowerCase() === 'create-agent')
    expect(createAgent).toHaveLength(1)
    expect(createAgent[0]).toEqual({
      name: 'create-agent',
      description: 'Write a custom agent under .vixl/agents.',
      scope: 'internal',
    })
    for (const name of modeSkillNames) {
      expect(hasSkill(index, name)).toBe(false)
    }
    expect(listVixlFiles).toHaveBeenCalledWith('personal', 'skills')
    expect(listVixlFiles).not.toHaveBeenCalledWith('project', 'skills', homeRoot)
  })

  it('keeps vendored command skills when user or project discovery throws', async () => {
    vi.mocked(listVixlFiles).mockImplementation(async () => {
      throw new Error('disk unavailable')
    })

    const index = await listSlashSkillIndex(projectA)

    for (const name of commandSkillNames) {
      expect(hasSkill(index, name, 'internal')).toBe(true)
    }
    expect(hasSkill(index, 'personal-notes')).toBe(false)
    expect(hasSkill(index, 'deploy-a')).toBe(false)
  })

  it('includes ungated internal command skills for a project root and for home', async () => {
    const projectIndex = await listSlashSkillIndex(projectA)
    const homeIndex = await listSlashSkillIndex(null)

    for (const name of commandSkillNames) {
      expect(hasSkill(projectIndex, name, 'internal')).toBe(true)
      expect(hasSkill(homeIndex, name, 'internal')).toBe(true)
    }
    expect(hasSkill(homeIndex, 'deploy-a')).toBe(false)
    for (const name of modeSkillNames) {
      expect(hasSkill(projectIndex, name)).toBe(false)
      expect(hasSkill(homeIndex, name)).toBe(false)
    }
  })

  it('does not let a user or project skill replace an internal command name', async () => {
    stubSkillDisks({
      personal: [
        {
          name: 'create-rule',
          path: 'skills/create-rule',
          description: 'User create rule',
        },
      ],
      byProject: {
        [projectA]: [
          {
            name: 'Create-Rule',
            path: '.vixl/skills/Create-Rule',
            description: 'Project create rule',
          },
        ],
      },
    })

    const index = await listSlashSkillIndex(projectA)
    const matched = index.filter((skill) => skill.name.toLowerCase() === 'create-rule')

    expect(matched).toHaveLength(1)
    expect(matched[0]).toEqual({
      name: 'create-rule',
      description: 'Write a project rule under .vixl/rules.',
      scope: 'internal',
    })
  })

  it('does not include another project skills when the active root changes', async () => {
    const index = await listSlashSkillIndex(projectB)

    expect(hasSkill(index, 'personal-notes', 'user')).toBe(true)
    expect(hasSkill(index, 'deploy-b', 'project')).toBe(true)
    expect(hasSkill(index, 'deploy-a')).toBe(false)

    const projectCalls = vi
      .mocked(listVixlFiles)
      .mock.calls.filter((call) => call[0] === 'project' && call[1] === 'skills')
    expect(projectCalls).toEqual([['project', 'skills', projectB]])
  })

  it('lets a project skill win a case-insensitive name collision with a personal skill', async () => {
    stubSkillDisks({
      personal: [
        {
          name: 'shared-skill',
          path: 'skills/shared-skill',
          description: 'From personal',
        },
      ],
      byProject: {
        [projectA]: [
          {
            name: 'Shared-Skill',
            path: '.vixl/skills/Shared-Skill',
            description: 'From project',
          },
        ],
      },
    })

    const index = await listSlashSkillIndex(projectA)
    const shared = index.filter((skill) => skill.name.toLowerCase() === 'shared-skill')

    expect(shared).toHaveLength(1)
    expect(shared[0]).toEqual({
      name: 'Shared-Skill',
      description: 'From project',
      scope: 'project',
    })
  })

  it('omits reserved slash names even when a user or project skill uses them', async () => {
    stubSkillDisks({
      personal: [
        ...personalSkills,
        {
          name: 'plan',
          path: 'skills/plan',
          description: 'User plan skill',
        },
        {
          name: 'ask',
          path: 'skills/ask',
          description: 'User ask skill',
        },
      ],
      byProject: {
        [projectA]: [
          ...projectASkills,
          {
            name: 'agent',
            path: '.vixl/skills/agent',
            description: 'Project agent skill',
          },
          {
            name: 'orchestrator',
            path: '.vixl/skills/orchestrator',
            description: 'Project orchestrator skill',
          },
        ],
      },
    })

    const index = await listSlashSkillIndex(projectA)

    expect(hasSkill(index, 'personal-notes', 'user')).toBe(true)
    expect(hasSkill(index, 'deploy-a', 'project')).toBe(true)
    expect(hasSkill(index, 'plan')).toBe(false)
    expect(hasSkill(index, 'ask')).toBe(false)
    expect(hasSkill(index, 'agent')).toBe(false)
    expect(hasSkill(index, 'orchestrator')).toBe(false)
  })

  it('lists personal skills and omits mode-gated internals when projectRoot is null', async () => {
    const index = await listSlashSkillIndex(null)

    expect(hasSkill(index, 'personal-notes', 'user')).toBe(true)
    expect(hasSkill(index, 'deploy-a')).toBe(false)
    expect(hasSkill(index, 'deploy-b')).toBe(false)
    for (const name of commandSkillNames) {
      expect(hasSkill(index, name, 'internal')).toBe(true)
    }
    for (const name of modeSkillNames) {
      expect(hasSkill(index, name)).toBe(false)
    }
    expect(listVixlFiles).toHaveBeenCalledWith('personal', 'skills')
    expect(listVixlFiles).not.toHaveBeenCalledWith('project', 'skills', expect.anything())
  })
})

describe('listStandaloneSkillIndex', () => {
  it('lists internal and personal skills without scanning a project root', async () => {
    const index = await listStandaloneSkillIndex('agent')

    expect(hasSkill(index, 'personal-notes', 'user')).toBe(true)
    expect(hasSkill(index, 'agent', 'internal')).toBe(true)
    expect(hasSkill(index, 'deploy-a')).toBe(false)
    expect(hasSkill(index, 'deploy-b')).toBe(false)
    for (const name of commandSkillNames) {
      expect(hasSkill(index, name, 'internal')).toBe(true)
    }
    expect(listVixlFiles).toHaveBeenCalledWith('personal', 'skills')
    expect(listVixlFiles).not.toHaveBeenCalledWith('project', 'skills', expect.anything())
  })

  it('keeps an internal command skill when a personal skill uses the same name', async () => {
    stubSkillDisks({
      personal: [
        {
          name: 'create-rule',
          path: 'skills/create-rule',
          description: 'User create rule',
        },
      ],
    })

    const index = await listStandaloneSkillIndex('agent')
    const matched = index.filter((skill) => skill.name.toLowerCase() === 'create-rule')

    expect(matched).toHaveLength(1)
    expect(matched[0]?.scope).toBe('internal')
  })
})

describe('loadSkill', () => {
  const skillFile = (body: string) => ({
    path: 'SKILL.md',
    content: `---\ndescription: Loaded\n---\n\n${body}\n`,
    totalLines: 4,
    offset: 0,
    limit: 0,
  })

  it('resolves internal skills before project or personal skills', async () => {
    const loaded = await loadSkill('create-agent', projectA)

    expect(loaded).toMatchObject({ scope: 'internal', name: 'create-agent' })
    expect(listVixlFiles).not.toHaveBeenCalled()
  })

  it('prefers a project skill over a personal skill for a real project root', async () => {
    stubSkillDisks({
      personal: [
        {
          name: 'shared',
          path: 'skills/shared',
          description: 'From personal',
        },
      ],
      byProject: {
        [projectA]: [
          {
            name: 'shared',
            path: '.vixl/skills/shared',
            description: 'From project',
          },
        ],
      },
    })
    vi.mocked(fsReadFile).mockResolvedValue(skillFile('Project body'))

    const loaded = await loadSkill('shared', projectA)

    expect(loaded).toMatchObject({ scope: 'project', content: 'Project body' })
    expect(fsReadFile).toHaveBeenCalledWith({
      projectRoot: projectA,
      path: '.vixl/skills/shared/SKILL.md',
    })
  })

  it('loads a personal skill for a home root and does not scan project skills', async () => {
    const homeRoot = '/Users/test-home'
    getUserHomeDir.mockResolvedValue(`${homeRoot}/`)
    stubSkillDisks({
      personal: [
        {
          name: 'shared',
          path: 'skills/shared',
          description: 'From personal',
        },
      ],
      byProject: {
        [homeRoot]: [
          {
            name: 'shared',
            path: '.vixl/skills/shared',
            description: 'From project scan',
          },
        ],
      },
    })
    vi.mocked(fsReadFile).mockResolvedValue(skillFile('Personal body'))

    const loaded = await loadSkill('shared', homeRoot)

    expect(loaded).toMatchObject({ scope: 'user', content: 'Personal body' })
    expect(listVixlFiles).toHaveBeenCalledWith('personal', 'skills')
    expect(listVixlFiles).not.toHaveBeenCalledWith('project', 'skills', homeRoot)
    expect(fsReadFile).toHaveBeenCalledWith({
      projectRoot: '/tmp/personal-vixl',
      path: 'skills/shared/SKILL.md',
    })
  })
})
