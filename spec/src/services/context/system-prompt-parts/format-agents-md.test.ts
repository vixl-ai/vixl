import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri())

import loadAgentsMd from '@/services/context/system-prompt-parts/format-agents-md'
import { fsReadFile } from '@/services/vixl/vixl-tauri'

const projectRoot = '/tmp/vixl'
const listed = {
  name: 'AGENTS.md',
  path: `${projectRoot}/.vixl/AGENTS.md`,
}

beforeEach(() => {
  vi.mocked(fsReadFile).mockReset()
  vi.mocked(fsReadFile).mockResolvedValue({
    path: '',
    content: '',
    totalLines: 0,
    offset: 0,
    limit: 0,
  })
})

describe('format-agents-md', () => {
  it('reads the listed .vixl/AGENTS.md body', async () => {
    vi.mocked(fsReadFile).mockResolvedValue({
      path: '.vixl/AGENTS.md',
      content: 'Use conventional commits.\n',
      totalLines: 1,
      offset: 0,
      limit: 1,
    })

    const formatted = await loadAgentsMd([listed], projectRoot)

    expect(formatted).toContain('Use conventional commits.')
    expect(fsReadFile).toHaveBeenCalledWith({
      projectRoot,
      path: '.vixl/AGENTS.md',
    })
  })

  it('returns empty when no entry is listed', async () => {
    const formatted = await loadAgentsMd([], projectRoot)
    expect(formatted).toBe('')
    expect(fsReadFile).not.toHaveBeenCalled()
  })

  it('does not read paths outside the project root', async () => {
    const formatted = await loadAgentsMd(
      [{ name: 'AGENTS.md', path: '/other/AGENTS.md' }],
      projectRoot,
    )
    expect(formatted).toContain('(outside project root)')
    expect(fsReadFile).not.toHaveBeenCalled()
  })

  it('marks unreadable files without throwing', async () => {
    vi.mocked(fsReadFile).mockRejectedValue(new Error('permission denied'))
    const formatted = await loadAgentsMd([listed], projectRoot)
    expect(formatted).toContain('(unreadable)')
  })
})
