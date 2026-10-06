import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import { HOME_PROJECT_SCOPE_ERROR } from '@/services/config/is-home-workspace-root'

const { fsWriteFile, getVixlDir, getUserHomeDir } = vi.hoisted(() => ({
  fsWriteFile: vi.fn<
    (args: { projectRoot: string; path: string; content: string }) => Promise<unknown>
  >(),
  getVixlDir: vi.fn<(scope: string) => Promise<string>>(),
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

import writeAgentsMd from '@/services/agents-md/write-agents-md'

describe('write-agents-md', () => {
  beforeEach(() => {
    fsWriteFile.mockReset()
    getVixlDir.mockReset()
    getUserHomeDir.mockReset()
    fsWriteFile.mockResolvedValue(undefined)
    getVixlDir.mockResolvedValue('/home/user/.vixl')
    getUserHomeDir.mockResolvedValue('/Users/test-home/')
  })

  it('writes project AGENTS.md under .vixl', async () => {
    const result = await writeAgentsMd({
      scope: 'project',
      projectRoot: '/repo',
    })

    expect(result.path).toBe('.vixl/AGENTS.md')
    expect(fsWriteFile).toHaveBeenCalledWith({
      projectRoot: '/repo',
      path: '.vixl/AGENTS.md',
      content: expect.stringContaining('# Project instructions'),
    })
    expect(getVixlDir).not.toHaveBeenCalled()
  })

  it('writes personal AGENTS.md at the vixl dir root', async () => {
    const result = await writeAgentsMd({ scope: 'personal' })

    expect(result.path).toBe('AGENTS.md')
    expect(getVixlDir).toHaveBeenCalledWith('personal')
    expect(fsWriteFile).toHaveBeenCalledWith({
      projectRoot: '/home/user/.vixl',
      path: 'AGENTS.md',
      content: expect.stringContaining('# Project instructions'),
    })
  })

  it('requires projectRoot for project scope', async () => {
    await expect(writeAgentsMd({ scope: 'project' })).rejects.toThrow(
      'projectRoot is required for project-scoped AGENTS.md',
    )
    expect(fsWriteFile).not.toHaveBeenCalled()
  })

  it('refuses a project write when the workspace root is the home directory', async () => {
    await expect(
      writeAgentsMd({ scope: 'project', projectRoot: '/Users/test-home' }),
    ).rejects.toThrow(HOME_PROJECT_SCOPE_ERROR)
    expect(fsWriteFile).not.toHaveBeenCalled()
    expect(getVixlDir).not.toHaveBeenCalled()
  })
})
