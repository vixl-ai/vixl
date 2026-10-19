import { describe, expect, it } from 'vitest'
import type { GitStatusEntry } from '@/types/git/git-status-entry'
import buildGitDecorationMaps, {
  decorationFromEntry,
  decorationLetter,
  decorationNameClass,
  hasDecorationLetter,
  resolvePathDecoration,
  rollupDecoration,
} from '@/utils/git-file-decoration'

const entry = (
  partial: Partial<GitStatusEntry> & Pick<GitStatusEntry, 'path'>,
): GitStatusEntry => ({
  isUntracked: false,
  isIgnored: false,
  ...partial,
})

describe('decorationFromEntry', () => {
  it('maps untracked entries to untracked', () => {
    expect(
      decorationFromEntry(
        entry({ path: 'new.ts', isUntracked: true, unstagedStatus: '?' }),
      ),
    ).toBe('untracked')
    expect(decorationLetter('untracked')).toBe('U')
    expect(decorationNameClass('untracked')).toContain('italic')
    expect(decorationNameClass('untracked')).toContain('teal')
    expect(decorationNameClass('added')).toContain('green')
    expect(decorationNameClass('added')).not.toContain('italic')
  })

  it('maps ignored entries without a letter badge', () => {
    expect(
      decorationFromEntry(
        entry({ path: 'node_modules/', isIgnored: true, unstagedStatus: '!' }),
      ),
    ).toBe('ignored')
    expect(hasDecorationLetter('ignored')).toBe(false)
    expect(decorationNameClass('ignored')).toContain('foreground/40')
  })

  it('rolls up the highest non-ignored decoration', () => {
    expect(
      rollupDecoration([
        entry({ path: 'a.ts', unstagedStatus: 'M' }),
        entry({ path: 'b.ts', isUntracked: true, unstagedStatus: '?' }),
        entry({ path: 'skip/', isIgnored: true, unstagedStatus: '!' }),
      ]),
    ).toBe('modified')
    expect(rollupDecoration([entry({ path: 'skip/', isIgnored: true })])).toBeNull()
  })

  it('prefers conflicted over modified', () => {
    expect(
      decorationFromEntry(
        entry({ path: 'a.ts', stagedStatus: 'U', unstagedStatus: 'U' }),
      ),
    ).toBe('conflicted')
  })

  it('maps staged added and worktree modified', () => {
    expect(
      decorationFromEntry(entry({ path: 'a.ts', stagedStatus: 'A' })),
    ).toBe('added')
    expect(
      decorationFromEntry(entry({ path: 'a.ts', unstagedStatus: 'M' })),
    ).toBe('modified')
    expect(
      decorationFromEntry(
        entry({ path: 'a.ts', stagedStatus: 'A', unstagedStatus: 'M' }),
      ),
    ).toBe('modified')
  })
})

describe('buildGitDecorationMaps', () => {
  it('builds file map and folder rollup by priority', () => {
    const { byPath, folderByPath } = buildGitDecorationMaps([
      entry({ path: 'src/a.ts', unstagedStatus: 'M' }),
      entry({ path: 'src/nested/b.ts', isUntracked: true, unstagedStatus: '?' }),
      entry({
        path: 'src/nested/c.ts',
        stagedStatus: 'U',
        unstagedStatus: 'U',
      }),
    ])

    expect(byPath.get('src/a.ts')).toBe('modified')
    expect(byPath.get('src/nested/b.ts')).toBe('untracked')
    expect(byPath.get('src/nested/c.ts')).toBe('conflicted')
    expect(folderByPath.get('src')).toBe('conflicted')
    expect(folderByPath.get('src/nested')).toBe('conflicted')
  })

  it('marks ignored directories without rolling up to parents', () => {
    const { byPath, folderByPath, ignoredRoots } = buildGitDecorationMaps([
      entry({ path: 'src/a.ts', unstagedStatus: 'M' }),
      entry({ path: 'node_modules/', isIgnored: true, unstagedStatus: '!' }),
    ])

    expect(byPath.get('node_modules')).toBe('ignored')
    expect(folderByPath.get('node_modules')).toBe('ignored')
    expect(ignoredRoots).toContain('node_modules')
    expect(folderByPath.get('src')).toBe('modified')
    expect(folderByPath.has('.')).toBe(false)
  })

  it('inherits ignored decoration for descendants', () => {
    const maps = buildGitDecorationMaps([
      entry({ path: 'node_modules/', isIgnored: true, unstagedStatus: '!' }),
    ])

    expect(
      resolvePathDecoration(
        'node_modules',
        maps.byPath,
        maps.folderByPath,
        maps.ignoredRoots,
        'folder',
      ),
    ).toBe('ignored')
    expect(
      resolvePathDecoration(
        'node_modules/lodash/index.js',
        maps.byPath,
        maps.folderByPath,
        maps.ignoredRoots,
        'file',
      ),
    ).toBe('ignored')
  })
})
