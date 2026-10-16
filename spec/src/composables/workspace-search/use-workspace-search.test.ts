import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

vi.hoisted(() => {
  Object.defineProperty(document, 'queryCommandSupported', {
    configurable: true,
    value: () => false,
  })
})
import type { GrepMatch, WorkspaceGrepResult } from '@/services/vixl/vixl-tauri'
import type { WorkspaceSearchMember } from '@/types/workbench/search-member'

const workspaceGrep = vi.hoisted(() =>
  vi.fn<(args: { projectRoot: string; maxResults?: number }) => Promise<WorkspaceGrepResult>>(),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    workspaceGrep: (args: { projectRoot: string; maxResults?: number }) =>
      workspaceGrep(args),
  }),
)

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('@/composables/workspace-search/replace-actions', () => ({
  createWorkspaceSearchReplaceActions: () => ({
    replaceOne: vi.fn<() => Promise<void>>(),
    replaceMatch: vi.fn<(hit: GrepMatch) => Promise<void>>(),
    replaceFile: vi.fn<(path: string, memberSlug?: string) => Promise<void>>(),
    replaceAll: vi.fn<() => Promise<void>>(),
  }),
}))

import useWorkspaceSearch, {
  SEARCH_MAX_RESULTS_PER_MEMBER,
} from '@/composables/workspace-search/use-workspace-search'

const hit = (path: string, line: string): GrepMatch => ({
  path,
  lineNumber: 1,
  line,
})

const grepResult = (
  matches: GrepMatch[],
  truncated = false,
): WorkspaceGrepResult => ({ matches, truncated })

describe('useWorkspaceSearch', () => {
  beforeEach(() => {
    workspaceGrep.mockReset()
  })

  it('greps a single projectRoot without member stamps', async () => {
    workspaceGrep.mockResolvedValueOnce(
      grepResult([hit('src/a.ts', 'foo'), hit('src/a.ts', 'foo2')]),
    )
    const projectRoot = ref<string | null>('/tmp/alpha')
    const search = useWorkspaceSearch(projectRoot)

    await search.runSearch('foo')

    expect(workspaceGrep).toHaveBeenCalledTimes(1)
    expect(workspaceGrep).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: '/tmp/alpha',
        pattern: 'foo',
        maxResults: 10000,
      }),
    )
    expect(search.groups.value).toEqual([
      {
        path: 'src/a.ts',
        hits: [hit('src/a.ts', 'foo'), hit('src/a.ts', 'foo2')],
      },
    ])
    expect(search.memberSections.value).toEqual([])
    expect(search.truncated.value).toBe(false)
  })

  it('fans out one grep per member, groups by slug, and caps per member', async () => {
    workspaceGrep.mockImplementation(async (args) => {
      if (args.projectRoot === '/tmp/alpha') {
        return grepResult([hit('src/index.ts', 'alpha hit')], true)
      }
      return grepResult([hit('src/index.ts', 'beta hit')], false)
    })

    const projectRoot = ref<string | null>('/tmp/alpha')
    const members = ref<WorkspaceSearchMember[] | null>([
      { slug: 'alpha', projectId: 'proj-a', rootPath: '/tmp/alpha' },
      { slug: 'beta', projectId: 'proj-b', rootPath: '/tmp/beta' },
    ])
    const search = useWorkspaceSearch(projectRoot, members)

    await search.runSearch('index')

    expect(workspaceGrep).toHaveBeenCalledTimes(2)
    expect(workspaceGrep).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        projectRoot: '/tmp/alpha',
        maxResults: SEARCH_MAX_RESULTS_PER_MEMBER,
      }),
    )
    expect(workspaceGrep).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        projectRoot: '/tmp/beta',
        maxResults: SEARCH_MAX_RESULTS_PER_MEMBER,
      }),
    )
    expect(search.memberSections.value.map((section) => ({
      slug: section.slug,
      truncated: section.truncated,
      paths: section.groups.map((group) => group.path),
    }))).toEqual([
      { slug: 'alpha', truncated: true, paths: ['src/index.ts'] },
      { slug: 'beta', truncated: false, paths: ['src/index.ts'] },
    ])
    expect(search.groups.value.map((group) => group.memberSlug)).toEqual([
      'alpha',
      'beta',
    ])
    expect(search.groups.value[0]?.projectRoot).toBe('/tmp/alpha')
    expect(search.groups.value[1]?.projectRoot).toBe('/tmp/beta')
    expect(search.truncated.value).toBe(true)
  })

  it('uses a single-project grep when only one member is provided', async () => {
    workspaceGrep.mockResolvedValueOnce(grepResult([hit('readme.md', 'x')]))
    const projectRoot = ref<string | null>('/tmp/alpha')
    const members = ref<WorkspaceSearchMember[] | null>([
      { slug: 'alpha', projectId: 'proj-a', rootPath: '/tmp/alpha' },
    ])
    const search = useWorkspaceSearch(projectRoot, members)

    await search.runSearch('x')

    expect(workspaceGrep).toHaveBeenCalledTimes(1)
    expect(workspaceGrep).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: '/tmp/alpha',
        maxResults: 10000,
      }),
    )
    expect(search.memberSections.value).toEqual([])
    expect(search.groups.value[0]).not.toHaveProperty('memberSlug')
  })
})
