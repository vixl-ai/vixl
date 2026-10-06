import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const getUserHomeDir = vi.hoisted(() =>
  vi.fn<() => Promise<string>>(async () => '/Users/test-home'),
)

vi.mock('@/services/vixl/vixl-tauri/home-dir', () => ({
  getUserHomeDir,
}))

vi.mock('@/services/vixl/vixl-tauri/helpers', async () => {
  const { createHomeWorkspaceHelpersMock } = await import(
    '../../../test-utils/mocks/home-workspace-command'
  )
  return createHomeWorkspaceHelpersMock(getUserHomeDir)
})

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri())

vi.mock('@/services/skills/discover-internal-skills', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/skills/discover-internal-skills')>()
  return {
    ...actual,
    loadInternalSkill: vi.fn<typeof actual.loadInternalSkill>((name) =>
      actual.loadInternalSkill(name),
    ),
  }
})

import assembleSystemPromptParts from '@/services/context/system-prompt-parts/assemble'
import { loadInternalSkill } from '@/services/skills/discover-internal-skills'
import {
  fsReadFile,
  getVixlDir,
  listVixlFiles,
  type ProjectFileEntry,
} from '@/services/vixl/vixl-tauri'

const projectRoot = '/tmp/vixl'
const personalDir = '/tmp/personal-vixl'

const input = (
  mode: 'ask' | 'plan' | 'agent' | 'orchestrator',
  extra: { standalone?: boolean } = {},
) => ({
  mode,
  projectName: 'vixl',
  projectRoot,
  mentions: [],
  agentCatalog: [],
  standalone: extra.standalone ?? true,
})

const agentDocument = (name: string, description: string, body: string): string => `---
name: ${JSON.stringify(name)}
description: ${JSON.stringify(description)}
---

${body}
`

const stubSkillDisks = (options: {
  personal?: ProjectFileEntry[]
  project?: ProjectFileEntry[]
}): void => {
  vi.mocked(listVixlFiles).mockImplementation(async (scope, kind, rootPath) => {
    if (kind !== 'skills') {
      return []
    }
    if (scope === 'personal') {
      return options.personal ?? []
    }
    if (scope === 'project' && rootPath === projectRoot) {
      return options.project ?? []
    }
    return []
  })
}

const otherSkills = {
  personal: [{ name: 'notes', path: 'skills/notes', description: 'User notes' }],
  project: [
    {
      name: 'deploy',
      path: `${projectRoot}/.vixl/skills/deploy`,
      description: 'Project deploy',
    },
  ],
}

const stubAgentDisks = (options: {
  personal?: ProjectFileEntry[]
  project?: ProjectFileEntry[]
  contents?: Record<string, string>
}): void => {
  vi.mocked(listVixlFiles).mockImplementation(async (scope, kind, rootPath) => {
    if (kind !== 'agents') {
      return []
    }
    if (scope === 'personal') {
      return options.personal ?? []
    }
    if (scope === 'project' && rootPath === projectRoot) {
      return options.project ?? []
    }
    return []
  })
  vi.mocked(fsReadFile).mockImplementation(async ({ path }) => {
    const content = options.contents?.[path]
    if (content === undefined) {
      throw new Error(`missing agent file: ${path}`)
    }
    return {
      path,
      content,
      totalLines: content.split('\n').length,
      offset: 0,
      limit: 0,
    }
  })
}

beforeEach(() => {
  vi.mocked(listVixlFiles).mockReset()
  vi.mocked(fsReadFile).mockReset()
  vi.mocked(getVixlDir).mockReset()
  getUserHomeDir.mockReset()
  getUserHomeDir.mockResolvedValue('/Users/test-home')
  vi.mocked(listVixlFiles).mockResolvedValue([])
  vi.mocked(getVixlDir).mockResolvedValue(personalDir)
  vi.mocked(fsReadFile).mockResolvedValue({
    path: '',
    content: '',
    totalLines: 0,
    offset: 0,
    limit: 0,
  })
})

describe('assemble system prompt parts', () => {
  it('replaces the prose tool catalog with a one-line hint', async () => {
    const parts = await assembleSystemPromptParts(input('ask'))
    expect(parts.tools).toBe('Tools are function calls, not repo code.')
    expect(parts.tools).not.toContain('Available tools in')
    expect(parts.base).not.toContain('- read_file:')
  })

  it('loads shared tool guidance and omits patch and embedded browser for all modes', async () => {
    for (const mode of ['ask', 'plan', 'agent', 'orchestrator'] as const) {
      const parts = await assembleSystemPromptParts(input(mode))
      expect(parts.base).toContain('codebase_explore')
      expect(parts.base).not.toContain('browser_lock')
      expect(parts.base).not.toContain('browser_cdp')
      expect(parts.base).not.toContain('apply_patch')
    }
  })

  it('injects listed .vixl/AGENTS.md into agentsMd', async () => {
    vi.mocked(listVixlFiles).mockImplementation(async (scope, kind) => {
      if (scope === 'project' && kind === 'agents-md') {
        return [
          {
            name: 'AGENTS.md',
            path: `${projectRoot}/.vixl/AGENTS.md`,
          },
        ]
      }
      return []
    })
    vi.mocked(fsReadFile).mockResolvedValue({
      path: '.vixl/AGENTS.md',
      content: 'Prefer kebab-case filenames.',
      totalLines: 1,
      offset: 0,
      limit: 1,
    })

    const parts = await assembleSystemPromptParts(input('agent', { standalone: false }))

    expect(parts.agentsMd).toContain('Prefer kebab-case filenames.')
    expect(parts.agentsMd).toContain('Project AGENTS.md guidance')
    expect(listVixlFiles).toHaveBeenCalledWith('personal', 'agents-md')
    expect(listVixlFiles).toHaveBeenCalledWith('project', 'agents-md', projectRoot)
    expect(fsReadFile).toHaveBeenCalledWith({
      projectRoot,
      path: '.vixl/AGENTS.md',
    })
  })

  it('injects personal .vixl/AGENTS.md for standalone home chats', async () => {
    vi.mocked(listVixlFiles).mockImplementation(async (...args) => {
      const [scope, kind] = args
      if (scope === 'personal' && kind === 'agents-md') {
        return [
          {
            name: 'AGENTS.md',
            path: `${personalDir}/AGENTS.md`,
          },
        ]
      }
      return []
    })
    vi.mocked(fsReadFile).mockResolvedValue({
      path: 'AGENTS.md',
      content: 'Prefer short replies.',
      totalLines: 1,
      offset: 0,
      limit: 1,
    })

    const parts = await assembleSystemPromptParts(input('agent', { standalone: true }))

    expect(parts.agentsMd).toContain('Prefer short replies.')
    expect(parts.agentsMd).toContain('Personal AGENTS.md guidance')
    expect(getVixlDir).toHaveBeenCalledWith('personal')
    expect(listVixlFiles).toHaveBeenCalledWith('personal', 'agents-md')
    expect(listVixlFiles).not.toHaveBeenCalledWith('project', 'agents-md', projectRoot)
    expect(fsReadFile).toHaveBeenCalledWith({
      projectRoot: personalDir,
      path: 'AGENTS.md',
    })
  })

  it('leaves standalone agentsMd empty when personal AGENTS.md is missing', async () => {
    const parts = await assembleSystemPromptParts(input('agent', { standalone: true }))
    expect(parts.agentsMd).toBe('')
    expect(listVixlFiles).toHaveBeenCalledWith('personal', 'agents-md')
    expect(listVixlFiles).not.toHaveBeenCalledWith('project', 'agents-md', projectRoot)
    expect(fsReadFile).not.toHaveBeenCalled()
  })

  it('discovers AGENTS.md only via listVixlFiles agents-md, never a repo glob', async () => {
    await assembleSystemPromptParts(input('agent', { standalone: false }))
    expect(listVixlFiles).toHaveBeenCalledWith('project', 'agents-md', projectRoot)
    const agentsMdCalls = vi
      .mocked(listVixlFiles)
      .mock.calls.filter((call) => call[1] === 'agents-md')
    expect(agentsMdCalls).toEqual([
      ['personal', 'agents-md'],
      ['project', 'agents-md', projectRoot],
    ])
    expect(fsReadFile).not.toHaveBeenCalled()
  })

  it('does not invent nested src/AGENTS.md when the lister omits it', async () => {
    vi.mocked(listVixlFiles).mockImplementation(async (scope, kind) => {
      if (scope === 'project' && kind === 'agents-md') {
        return [
          {
            name: 'AGENTS.md',
            path: `${projectRoot}/.vixl/AGENTS.md`,
          },
        ]
      }
      return []
    })
    vi.mocked(fsReadFile).mockResolvedValue({
      path: '.vixl/AGENTS.md',
      content: 'project agents file',
      totalLines: 1,
      offset: 0,
      limit: 1,
    })

    const parts = await assembleSystemPromptParts(input('agent', { standalone: false }))

    expect(parts.agentsMd).toContain('project agents file')
    const readPaths = vi.mocked(fsReadFile).mock.calls.map((call) => call[0]?.path)
    expect(readPaths).toEqual(['.vixl/AGENTS.md'])
    expect(readPaths).not.toContain('src/AGENTS.md')
    expect(readPaths).not.toContain('AGENTS.md')
  })

  it('returns empty agentsMd when reconstructing a frozen snapshot without parts', async () => {
    const parts = await assembleSystemPromptParts({
      ...input('agent'),
      frozenSnapshot: {
        systemString: 'frozen-system',
        toolSchemasJson: '',
        mcpCatalogSnapshot: '',
        rulesBodies: '',
        hash: 'deadbeef',
        frozenAt: '2026-01-01T00:00:00.000Z',
      },
    })
    expect(parts.agentsMd).toBe('')
    expect(parts.base).toBe('frozen-system')
    expect(listVixlFiles).not.toHaveBeenCalled()
  })

  it('lists personal and project agents in Available subagents', async () => {
    stubAgentDisks({
      personal: [
        {
          name: 'notes.md',
          path: `${personalDir}/agents/notes.md`,
          description: 'Personal notes helper',
        },
      ],
      project: [
        {
          name: 'deploy.md',
          path: `${projectRoot}/.vixl/agents/deploy.md`,
          description: 'Project deploy helper',
        },
      ],
      contents: {
        'agents/notes.md': agentDocument(
          'notes',
          'Personal notes helper',
          'Capture personal notes.',
        ),
        '.vixl/agents/deploy.md': agentDocument(
          'deploy',
          'Project deploy helper',
          'Ship the project.',
        ),
      },
    })

    const parts = await assembleSystemPromptParts(input('agent', { standalone: false }))

    expect(parts.subagents).toContain('Available subagents:')
    expect(parts.subagents).toContain('- notes: Personal notes helper')
    expect(parts.subagents).toContain('- deploy: Project deploy helper')
  })

  it('lets a project agent description win a name collision', async () => {
    stubAgentDisks({
      personal: [
        {
          name: 'reviewer.md',
          path: `${personalDir}/agents/reviewer.md`,
          description: 'Personal review helper',
        },
      ],
      project: [
        {
          name: 'reviewer.md',
          path: `${projectRoot}/.vixl/agents/reviewer.md`,
          description: 'Project review helper',
        },
      ],
      contents: {
        'agents/reviewer.md': agentDocument(
          'reviewer',
          'Personal review helper',
          'Personal review body.',
        ),
        '.vixl/agents/reviewer.md': agentDocument(
          'reviewer',
          'Project review helper',
          'Project review body.',
        ),
      },
    })

    const parts = await assembleSystemPromptParts(input('agent', { standalone: false }))

    expect(parts.subagents).toContain('- reviewer: Project review helper')
    expect(parts.subagents).not.toContain('Personal review helper')
  })

  it('includes personal-only agents for standalone chats', async () => {
    stubAgentDisks({
      personal: [
        {
          name: 'notes.md',
          path: `${personalDir}/agents/notes.md`,
          description: 'Personal notes helper',
        },
      ],
      project: [
        {
          name: 'deploy.md',
          path: `${projectRoot}/.vixl/agents/deploy.md`,
          description: 'Project deploy helper',
        },
      ],
      contents: {
        'agents/notes.md': agentDocument(
          'notes',
          'Personal notes helper',
          'Capture personal notes.',
        ),
        '.vixl/agents/deploy.md': agentDocument(
          'deploy',
          'Project deploy helper',
          'Ship the project.',
        ),
      },
    })

    const parts = await assembleSystemPromptParts(input('agent', { standalone: true }))

    expect(parts.subagents).toContain('Available subagents:')
    expect(parts.subagents).toContain('- notes: Personal notes helper')
    expect(parts.subagents).not.toContain('deploy')
    expect(listVixlFiles).toHaveBeenCalledWith('personal', 'agents')
    expect(listVixlFiles).not.toHaveBeenCalledWith('project', 'agents', projectRoot)
  })

  it('does not put explicit agent invocation into assembled parts', async () => {
    const parts = await assembleSystemPromptParts({
      ...input('agent'),
      mentions: [{ type: 'agent', name: 'reviewer' }],
    })
    const joined = [parts.base, parts.subagents, parts.mentions, parts.skills].join('\n')
    expect(joined).not.toContain('explicitly invoked')
    expect(parts.mentions).not.toContain('reviewer')
    expect(parts.skills).not.toContain('Skill reviewer')
  })

  it('omits the inlined orchestrator skill from standalone Available skills', async () => {
    const parts = await assembleSystemPromptParts(input('orchestrator'))

    expect(parts.base).toContain('Orchestrator mode')
    expect(parts.skills).not.toContain('- orchestrator:')
  })

  it('lists personal skills and vendored commands on standalone Available skills', async () => {
    stubSkillDisks(otherSkills)

    const parts = await assembleSystemPromptParts(input('orchestrator'))

    expect(parts.skills).toContain('Available skills:')
    expect(parts.skills).toContain('- notes: User notes')
    expect(parts.skills).toContain('- create-agent:')
    expect(parts.skills).not.toContain('- deploy:')
    expect(parts.skills).not.toContain('- orchestrator:')
    expect(listVixlFiles).toHaveBeenCalledWith('personal', 'skills')
    expect(listVixlFiles).not.toHaveBeenCalledWith('project', 'skills', projectRoot)
  })

  it('omits the inlined orchestrator skill from Available skills but lists others', async () => {
    stubSkillDisks(otherSkills)

    const parts = await assembleSystemPromptParts(input('orchestrator', { standalone: false }))

    expect(parts.base).toContain('Orchestrator mode')
    expect(parts.skills).toContain('Available skills:')
    expect(parts.skills).toContain('- notes: User notes')
    expect(parts.skills).toContain('- deploy: Project deploy')
    expect(parts.skills).not.toContain('- orchestrator:')
  })

  it.each(['ask', 'plan', 'agent'] as const)(
    'omits the inlined %s skill from Available skills but lists others',
    async (mode) => {
      stubSkillDisks(otherSkills)

      const parts = await assembleSystemPromptParts(input(mode, { standalone: false }))

      expect(parts.skills).toContain('- notes: User notes')
      expect(parts.skills).toContain('- deploy: Project deploy')
      expect(parts.skills).not.toContain(`- ${mode}:`)
    },
  )

  it('lists the mode skill when it is not inlined', async () => {
    vi.mocked(loadInternalSkill).mockReturnValueOnce(null)

    const parts = await assembleSystemPromptParts(input('orchestrator'))

    expect(parts.base).not.toContain('Orchestrator mode')
    expect(parts.skills).toContain('- orchestrator:')
  })

  it('injects personal rules before project rules on project chats', async () => {
    vi.mocked(listVixlFiles).mockImplementation(async (scope, kind) => {
      if (kind !== 'rules') {
        return []
      }
      if (scope === 'personal') {
        return [{ name: 'home.md', path: `${personalDir}/rules/home.md` }]
      }
      if (scope === 'project') {
        return [{ name: 'proj.md', path: `${projectRoot}/.vixl/rules/proj.md` }]
      }
      return []
    })
    vi.mocked(fsReadFile).mockImplementation(async ({ path }) => {
      const content = path.endsWith('home.md') ? 'personal rule body' : 'project rule body'
      return { path, content, totalLines: 1, offset: 0, limit: 1 }
    })

    const parts = await assembleSystemPromptParts(input('agent', { standalone: false }))

    const personalAt = parts.rules.indexOf('Personal guidance (not a security override):')
    const projectAt = parts.rules.indexOf('Project guidance (not a security override):')
    expect(personalAt).toBeGreaterThanOrEqual(0)
    expect(projectAt).toBeGreaterThan(personalAt)
    expect(parts.rules.indexOf('personal rule body')).toBeLessThan(
      parts.rules.indexOf('project rule body'),
    )
    expect(fsReadFile).toHaveBeenCalledWith({
      projectRoot: personalDir,
      path: 'rules/home.md',
    })
    expect(fsReadFile).toHaveBeenCalledWith({
      projectRoot,
      path: '.vixl/rules/proj.md',
    })
  })

  it('injects personal rules only for standalone home chats', async () => {
    vi.mocked(listVixlFiles).mockImplementation(async (scope, kind) => {
      if (kind !== 'rules') {
        return []
      }
      if (scope === 'personal') {
        return [{ name: 'home.md', path: `${personalDir}/rules/home.md` }]
      }
      return [{ name: 'proj.md', path: `${projectRoot}/.vixl/rules/proj.md` }]
    })
    vi.mocked(fsReadFile).mockResolvedValue({
      path: 'rules/home.md',
      content: 'personal rule body',
      totalLines: 1,
      offset: 0,
      limit: 1,
    })

    const parts = await assembleSystemPromptParts(input('agent', { standalone: true }))

    expect(parts.rules).toContain('Personal guidance (not a security override):')
    expect(parts.rules).toContain('personal rule body')
    expect(parts.rules).not.toContain('Project guidance')
    expect(parts.rules).not.toContain('project rule body')
    expect(listVixlFiles).not.toHaveBeenCalledWith('project', 'rules', projectRoot)
  })

  it('does not append project rules when the project root is the home directory', async () => {
    getUserHomeDir.mockResolvedValue(projectRoot)
    vi.mocked(listVixlFiles).mockImplementation(async (scope, kind) => {
      if (kind !== 'rules') {
        return []
      }
      if (scope === 'personal') {
        return [{ name: 'home.md', path: `${personalDir}/rules/home.md` }]
      }
      return [{ name: 'proj.md', path: `${projectRoot}/.vixl/rules/proj.md` }]
    })
    vi.mocked(fsReadFile).mockResolvedValue({
      path: 'rules/home.md',
      content: 'personal rule body',
      totalLines: 1,
      offset: 0,
      limit: 1,
    })

    const parts = await assembleSystemPromptParts(input('agent', { standalone: false }))

    expect(parts.rules).toContain('personal rule body')
    expect(parts.rules).not.toContain('Project guidance')
    expect(listVixlFiles).not.toHaveBeenCalledWith('project', 'rules', projectRoot)
  })

  it('concatenates personal AGENTS.md before project AGENTS.md', async () => {
    vi.mocked(listVixlFiles).mockImplementation(async (scope, kind) => {
      if (kind !== 'agents-md') {
        return []
      }
      if (scope === 'personal') {
        return [{ name: 'AGENTS.md', path: `${personalDir}/AGENTS.md` }]
      }
      return [{ name: 'AGENTS.md', path: `${projectRoot}/.vixl/AGENTS.md` }]
    })
    vi.mocked(fsReadFile).mockImplementation(async ({ path }) => {
      const content = path === 'AGENTS.md' ? 'Home agents guidance.' : 'Project agents guidance.'
      return { path, content, totalLines: 1, offset: 0, limit: 1 }
    })

    const parts = await assembleSystemPromptParts(input('agent', { standalone: false }))

    expect(parts.agentsMd.indexOf('Personal AGENTS.md guidance:')).toBeGreaterThanOrEqual(0)
    expect(parts.agentsMd.indexOf('Personal AGENTS.md guidance:')).toBeLessThan(
      parts.agentsMd.indexOf('Project AGENTS.md guidance:'),
    )
    expect(parts.agentsMd.indexOf('Home agents guidance.')).toBeLessThan(
      parts.agentsMd.indexOf('Project agents guidance.'),
    )
  })

  it('keeps standalone AGENTS.md personal only when the root is the home directory', async () => {
    getUserHomeDir.mockResolvedValue(projectRoot)
    vi.mocked(listVixlFiles).mockImplementation(async (scope, kind) => {
      if (scope === 'personal' && kind === 'agents-md') {
        return [{ name: 'AGENTS.md', path: `${personalDir}/AGENTS.md` }]
      }
      if (kind === 'agents-md') {
        return [{ name: 'AGENTS.md', path: `${projectRoot}/.vixl/AGENTS.md` }]
      }
      return []
    })
    vi.mocked(fsReadFile).mockResolvedValue({
      path: 'AGENTS.md',
      content: 'Home agents guidance.',
      totalLines: 1,
      offset: 0,
      limit: 1,
    })

    const parts = await assembleSystemPromptParts(input('agent', { standalone: true }))

    expect(parts.agentsMd).toContain('Home agents guidance.')
    expect(parts.agentsMd).not.toContain('Project AGENTS.md guidance')
    expect(listVixlFiles).not.toHaveBeenCalledWith('project', 'agents-md', projectRoot)
  })
})
