import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const { readMcpConfig } = vi.hoisted(() => ({
  readMcpConfig: vi.fn<(scope: string, rootPath?: string | null) => Promise<unknown>>(
    async () => ({ servers: {} }),
  ),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    readMcpConfig,
  }),
)

import { resolveEffectiveServerConfig } from '@/composables/mcp-servers/helpers'
import { personalMcp, projectMcp } from '@/composables/mcp-servers/state'

const personalGithub = { command: 'npx', args: ['personal-mcp'] }
const projectGithub = { type: 'http' as const, url: 'https://mcp.example/github' }

describe('resolveEffectiveServerConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    personalMcp.value = {
      servers: { github: personalGithub },
    }
    projectMcp.value = {
      servers: { github: projectGithub },
    }
    readMcpConfig.mockResolvedValue({
      servers: { github: projectGithub },
    })
  })

  it('returns the personal config for personal scope even when overridden in project', async () => {
    const config = await resolveEffectiveServerConfig('github', undefined, 'personal')

    expect(config).toEqual(personalGithub)
    expect(readMcpConfig).not.toHaveBeenCalled()
  })

  it('defaults a missing scope to the personal config', async () => {
    const config = await resolveEffectiveServerConfig('github')

    expect(config).toEqual(personalGithub)
    expect(readMcpConfig).not.toHaveBeenCalled()
  })

  it('returns an explicit config without reading project mcp.json', async () => {
    const explicit = { command: 'npx', args: ['explicit'] }
    const config = await resolveEffectiveServerConfig('github', explicit, '/tmp/project')

    expect(config).toEqual(explicit)
    expect(readMcpConfig).not.toHaveBeenCalled()
  })

  it('returns the project override for a project root scope', async () => {
    const config = await resolveEffectiveServerConfig('github', undefined, '/tmp/project')

    expect(readMcpConfig).toHaveBeenCalledWith('project', '/tmp/project')
    expect(config).toEqual(projectGithub)
  })
})
