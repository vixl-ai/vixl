import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

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
    vi.mocked(listVixlFiles).mockImplementation(async (...args) => {
      const kind = args[1]
      if (kind === 'agents-md') {
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
    expect(parts.agentsMd).toContain('AGENTS.md guidance')
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
    expect(parts.agentsMd).toContain('AGENTS.md guidance')
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
    expect(agentsMdCalls).toEqual([['project', 'agents-md', projectRoot]])
    expect(fsReadFile).not.toHaveBeenCalled()
  })

  it('does not invent nested src/AGENTS.md when the lister omits it', async () => {
    vi.mocked(listVixlFiles).mockImplementation(async (...args) => {
      const kind = args[1]
      if (kind === 'agents-md') {
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

  it('lists home-workspace skills and vendored commands on standalone Available skills', async () => {
    stubSkillDisks(otherSkills)

    const parts = await assembleSystemPromptParts(input('orchestrator'))

    expect(parts.skills).toContain('Available skills:')
    expect(parts.skills).toContain('- deploy: Project deploy')
    expect(parts.skills).toContain('- create-agent:')
    expect(parts.skills).not.toContain('- notes:')
    expect(parts.skills).not.toContain('- orchestrator:')
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
})
