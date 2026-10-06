import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import { HOME_PROJECT_SCOPE_ERROR } from '@/services/config/is-home-workspace-root'

const { readSettings, writeSettings, getUserHomeDir } = vi.hoisted(() => ({
  readSettings: vi.fn<
    (scope: string, rootPath?: string | null) => Promise<Record<string, unknown>>
  >(async () => ({ version: 1 })),
  writeSettings: vi.fn<
    (
      scope: string,
      settings: Record<string, unknown>,
      rootPath?: string | null,
    ) => Promise<void>
  >(async () => undefined),
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
    readSettings,
    writeSettings,
  }),
)

import {
  loadEffectiveSettings,
  loadProjectSettings,
  saveSettings,
} from '@/services/config/vixl-config'

const homeRoot = '/Users/test-home'
const projectRoot = '/tmp/proj'

beforeEach(() => {
  readSettings.mockReset()
  writeSettings.mockReset()
  getUserHomeDir.mockReset()
  writeSettings.mockResolvedValue(undefined)
  getUserHomeDir.mockResolvedValue(`${homeRoot}/`)
  readSettings.mockImplementation(async (scope) => {
    if (scope === 'personal') {
      return {
        version: 1,
        'appearance.theme': 'dark',
        'lsp.autoDownload': false,
      }
    }
    return {
      version: 1,
      'appearance.theme': 'light',
      'lsp.autoDownload': true,
    }
  })
})

describe('home workspace settings guard', () => {
  it('loads personal settings only and does not rewrite the home settings file', async () => {
    const effective = await loadEffectiveSettings(homeRoot)

    expect(effective['appearance.theme']).toBe('dark')
    expect(effective['lsp.autoDownload']).toBe(false)
    expect(readSettings).toHaveBeenCalledWith('personal')
    expect(readSettings).not.toHaveBeenCalledWith('project', expect.anything())
    expect(writeSettings).not.toHaveBeenCalled()
  })

  it('returns empty project overrides for the home directory without reading or writing', async () => {
    const project = await loadProjectSettings(`${homeRoot}/`)

    expect(project).toEqual({ version: 1 })
    expect(readSettings).not.toHaveBeenCalled()
    expect(writeSettings).not.toHaveBeenCalled()
  })

  it('refuses to save project settings for the home directory', async () => {
    await expect(
      saveSettings('project', { version: 1, 'appearance.theme': 'light' }, homeRoot),
    ).rejects.toThrow(HOME_PROJECT_SCOPE_ERROR)

    expect(writeSettings).not.toHaveBeenCalled()
  })

  it('still merges a real project and strips personal-only keys before writing', async () => {
    const effective = await loadEffectiveSettings(projectRoot)

    expect(effective['appearance.theme']).toBe('light')
    expect(effective['lsp.autoDownload']).toBe(false)
    expect(readSettings).toHaveBeenCalledWith('project', projectRoot)
    expect(writeSettings).toHaveBeenCalledWith(
      'project',
      expect.not.objectContaining({ 'lsp.autoDownload': true }),
      projectRoot,
    )
    const written = writeSettings.mock.calls[0]?.[1]
    expect(written?.['appearance.theme']).toBe('light')
    expect(written).not.toHaveProperty('lsp.autoDownload')
  })
})
