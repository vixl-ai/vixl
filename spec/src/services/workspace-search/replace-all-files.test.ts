import { describe, expect, it, vi } from 'vitest'
import type { SearchFileGroup } from '@/types/workbench/search-file-group'
import type { SearchReplaceOptions } from '@/types/workbench/search-replace-options'

const replaceInFile = vi.hoisted(() =>
  vi.fn<(args: { projectRoot: string; path: string }) => Promise<{ count: number }>>(),
)

vi.mock('@/services/workspace-search/replace-in-file', () => ({
  default: (args: { projectRoot: string; path: string }) => replaceInFile(args),
}))

import replaceAllFiles from '@/services/workspace-search/replace-all-files'

const options: SearchReplaceOptions = {
  matchCase: false,
  wholeWord: false,
  regex: false,
}

describe('replaceAllFiles member roots', () => {
  it('uses each file group projectRoot when present', async () => {
    replaceInFile.mockReset()
    replaceInFile.mockResolvedValue({ count: 1 })

    const groups: SearchFileGroup[] = [
      {
        path: 'src/index.ts',
        hits: [],
        memberSlug: 'alpha',
        projectRoot: '/tmp/alpha',
      },
      {
        path: 'src/index.ts',
        hits: [],
        memberSlug: 'beta',
        projectRoot: '/tmp/beta',
      },
    ]

    const result = await replaceAllFiles({
      projectRoot: '/tmp/fallback',
      groups,
      find: 'foo',
      replace: 'bar',
      options,
    })

    expect(replaceInFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        projectRoot: '/tmp/alpha',
        path: 'src/index.ts',
      }),
    )
    expect(replaceInFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        projectRoot: '/tmp/beta',
        path: 'src/index.ts',
      }),
    )
    expect(result).toEqual({ occurrenceCount: 2, fileCount: 2 })
  })

  it('falls back to the shared projectRoot when groups are unstamped', async () => {
    replaceInFile.mockReset()
    replaceInFile.mockResolvedValue({ count: 1 })

    await replaceAllFiles({
      projectRoot: '/tmp/alpha',
      groups: [{ path: 'readme.md', hits: [] }],
      find: 'foo',
      replace: 'bar',
      options,
    })

    expect(replaceInFile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: '/tmp/alpha',
        path: 'readme.md',
      }),
    )
  })
})
