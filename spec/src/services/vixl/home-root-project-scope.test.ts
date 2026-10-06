import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockedHomeWorkspaceRoot } from '../../test-utils/mocks/home-workspace-command'

const { call } = vi.hoisted(() => ({
  call: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(
    async () => true,
  ),
}))

vi.mock('@/services/vixl/vixl-tauri/helpers', () => ({
  isTauri: () => true,
  call: (command: string, args?: Record<string, unknown>) => call(command, args),
}))

import { HOME_PROJECT_SCOPE_ERROR } from '@/services/config/is-home-workspace-root'
import {
  hasProjectVixl,
  listVixlFiles,
  readMcpConfig,
  readSettings,
  setMcpServerEnabled,
  writeMcpConfig,
  writeSettings,
} from '@/services/vixl/vixl-tauri/config'

const homeRoot = '/Users/test-home'

let commandResult: unknown = true

const backendCalls = () =>
  call.mock.calls.filter(([command]) => command !== 'is_home_workspace_root')

beforeEach(() => {
  commandResult = true
  call.mockReset()
  call.mockImplementation(async (command, args) => {
    if (command === 'is_home_workspace_root') {
      return mockedHomeWorkspaceRoot(args?.rootPath, async () => `${homeRoot}/`)
    }
    return commandResult
  })
})

describe('project scope on the home directory', () => {
  it('does not treat personal ~/.vixl as a project vixl root', async () => {
    await expect(hasProjectVixl(homeRoot)).resolves.toBe(false)
    expect(backendCalls()).toEqual([])
  })

  it('still asks the backend for a real project root', async () => {
    await expect(hasProjectVixl('/tmp/proj')).resolves.toBe(true)
    expect(call).toHaveBeenCalledWith('has_project_vixl', { rootPath: '/tmp/proj' })
  })

  it('refuses project settings and MCP writes for the home directory', async () => {
    await expect(writeSettings('project', { version: 1 }, homeRoot)).rejects.toThrow(
      HOME_PROJECT_SCOPE_ERROR,
    )
    await expect(writeMcpConfig('project', { servers: {} }, `${homeRoot}/`)).rejects.toThrow(
      HOME_PROJECT_SCOPE_ERROR,
    )
    await expect(
      setMcpServerEnabled('project', 'brave', false, homeRoot),
    ).rejects.toThrow(HOME_PROJECT_SCOPE_ERROR)
    expect(backendCalls()).toEqual([])
  })

  it('returns empty project reads for the home directory', async () => {
    commandResult = { version: 1, 'appearance.theme': 'dark' }

    await expect(readSettings('project', homeRoot)).resolves.toEqual({ version: 1 })
    await expect(readMcpConfig('project', `${homeRoot}/`)).resolves.toEqual({ servers: {} })
    await expect(listVixlFiles('project', 'agents', homeRoot)).resolves.toEqual([])
    await expect(readSettings('personal')).resolves.toEqual({
      version: 1,
      'appearance.theme': 'dark',
    })
    expect(backendCalls()).toHaveLength(1)
    expect(call).toHaveBeenCalledWith('read_settings', {
      scope: 'personal',
      rootPath: null,
    })
  })

  it('still writes personal scope and real project roots', async () => {
    await writeSettings('personal', { version: 1 }, homeRoot)
    await writeMcpConfig('project', { servers: {} }, '/tmp/proj')

    expect(call).toHaveBeenCalledWith('write_settings', {
      scope: 'personal',
      settings: { version: 1 },
      rootPath: homeRoot,
    })
    expect(call).toHaveBeenCalledWith('write_mcp_config', {
      scope: 'project',
      config: { servers: {} },
      rootPath: '/tmp/proj',
    })
  })
})
