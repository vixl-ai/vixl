import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const { fsWriteFile, getVixlDir } = vi.hoisted(() => ({
  fsWriteFile: vi.fn<
    (args: { projectRoot: string; path: string; content: string }) => Promise<unknown>
  >(),
  getVixlDir: vi.fn<(scope: string) => Promise<string>>(),
}))

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
    fsWriteFile.mockResolvedValue(undefined)
    getVixlDir.mockResolvedValue('/home/user/.vixl')
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
})
