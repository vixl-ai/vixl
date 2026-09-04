import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri())

import assembleSystemPromptParts from '@/services/context/system-prompt-parts/assemble'
import { fsReadFile, getVixlDir, listVixlFiles } from '@/services/vixl/vixl-tauri'

const projectRoot = '/tmp/vixl'
const personalDir = '/tmp/personal-vixl'

const input = (
  mode: 'ask' | 'plan' | 'agent' | 'studio' | 'orchestrator',
  extra: { standalone?: boolean } = {},
) => ({
  mode,
  projectName: 'vixl',
  projectRoot,
  mentions: [],
  agentCatalog: [],
  standalone: extra.standalone ?? true,
})

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
    expect(parts.tools).toBe(
      'Tools are provided as function calls; do not grep the repo for them.',
    )
    expect(parts.tools).not.toContain('Available tools in')
    expect(parts.base).not.toContain('- read_file:')
  })

  it('includes MCP and shell but not patch or embedded browser guidance for ask and plan', async () => {
    for (const mode of ['ask', 'plan'] as const) {
      const parts = await assembleSystemPromptParts(input(mode))
      expect(parts.base).toContain('get_mcp_tools if stale')
      expect(parts.base).toContain('run_terminal only')
      expect(parts.base).not.toContain('browser_lock')
      expect(parts.base).not.toContain('apply_patch is OpenCode-style')
    }
  })

  it('includes allowlisted tool guidance for agent', async () => {
    const parts = await assembleSystemPromptParts(input('agent'))
    expect(parts.base).not.toContain('browser_lock')
    expect(parts.base).toContain('run_terminal only')
    expect(parts.base).toContain('get_mcp_tools if stale')
    expect(parts.base).toContain('apply_patch is OpenCode-style')
  })

  it('includes MCP and shell but not patch or embedded browser for studio', async () => {
    const parts = await assembleSystemPromptParts(input('studio'))
    expect(parts.base).toContain('get_mcp_tools if stale')
    expect(parts.base).toContain('run_terminal only')
    expect(parts.base).not.toContain('browser_lock')
    expect(parts.base).not.toContain('apply_patch is OpenCode-style')
  })

  it('keeps studio block catalog out of the always-on base', async () => {
    const parts = await assembleSystemPromptParts(input('studio'))
    expect(parts.base).toContain('load_skill("studio-blocks")')
    expect(parts.base).not.toContain('::page-header')
    expect(parts.skills).toContain('studio-blocks')
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
    expect(listVixlFiles).not.toHaveBeenCalledWith(
      'project',
      'agents-md',
      projectRoot,
    )
    expect(fsReadFile).toHaveBeenCalledWith({
      projectRoot: personalDir,
      path: 'AGENTS.md',
    })
  })

  it('leaves standalone agentsMd empty when personal AGENTS.md is missing', async () => {
    const parts = await assembleSystemPromptParts(input('agent', { standalone: true }))
    expect(parts.agentsMd).toBe('')
    expect(listVixlFiles).toHaveBeenCalledWith('personal', 'agents-md')
    expect(listVixlFiles).not.toHaveBeenCalledWith(
      'project',
      'agents-md',
      projectRoot,
    )
    expect(fsReadFile).not.toHaveBeenCalled()
  })

  it('discovers AGENTS.md only via listVixlFiles agents-md, never a repo glob', async () => {
    await assembleSystemPromptParts(input('agent', { standalone: false }))
    expect(listVixlFiles).toHaveBeenCalledWith('project', 'agents-md', projectRoot)
    const agentsMdCalls = vi.mocked(listVixlFiles).mock.calls.filter(
      (call) => call[1] === 'agents-md',
    )
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
})
