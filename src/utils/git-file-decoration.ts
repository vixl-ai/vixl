import type { GitFileDecoration } from '@/types/git/git-file-decoration'
import type { GitStatusEntry } from '@/types/git/git-status-entry'

const DECORATION_PRIORITY: Record<GitFileDecoration, number> = {
  conflicted: 6,
  modified: 5,
  untracked: 4,
  added: 4,
  deleted: 3,
  renamed: 2,
  // Ignored is weakest and does not roll up to parents (VS Code behavior).
  ignored: 1,
}

const DECORATION_CLASS: Record<GitFileDecoration, string> = {
  // Added = staged new (tracked). Untracked = never in git (teal + italic).
  added: 'text-green-500 dark:text-green-300',
  untracked: 'text-teal-500 dark:text-teal-300',
  modified: 'text-amber-500 dark:text-amber-300',
  deleted: 'text-red-500 dark:text-red-300',
  renamed: 'text-sky-500 dark:text-sky-300',
  conflicted: 'text-red-500 dark:text-red-300',
  ignored: 'text-foreground/40',
}

const DECORATION_LETTER: Record<GitFileDecoration, string> = {
  added: 'A',
  untracked: 'U',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  conflicted: 'C',
  // VS Code dims ignored paths without a letter badge.
  ignored: '',
}

const DECORATION_LABEL: Record<GitFileDecoration, string> = {
  added: 'Added',
  untracked: 'Untracked',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
  conflicted: 'Conflicted',
  ignored: 'Ignored',
}

const normalizePath = (path: string): string => path.replace(/\/+$/, '')

const decorationFromCode = (code: string | null | undefined): GitFileDecoration | null => {
  if (!code) {
    return null
  }
  switch (code) {
    case 'U':
      return 'conflicted'
    case 'M':
    case 'T':
      return 'modified'
    case 'A':
      return 'added'
    case '?':
      return 'untracked'
    case '!':
      return 'ignored'
    case 'D':
      return 'deleted'
    case 'R':
    case 'C':
      return 'renamed'
    default:
      return 'modified'
  }
}

const preferDecoration = (
  left: GitFileDecoration | null,
  right: GitFileDecoration | null,
): GitFileDecoration | null => {
  if (!left) {
    return right
  }
  if (!right) {
    return left
  }
  return DECORATION_PRIORITY[left] >= DECORATION_PRIORITY[right] ? left : right
}

export const decorationFromEntry = (
  entry: GitStatusEntry,
): GitFileDecoration | null => {
  if (entry.isIgnored) {
    return 'ignored'
  }
  if (entry.isUntracked) {
    return 'untracked'
  }
  return preferDecoration(
    decorationFromCode(entry.stagedStatus),
    decorationFromCode(entry.unstagedStatus),
  )
}

export const rollupDecoration = (
  entries: GitStatusEntry[],
): GitFileDecoration | null => {
  let best: GitFileDecoration | null = null
  for (const entry of entries) {
    const next = decorationFromEntry(entry)
    if (!next || next === 'ignored') {
      continue
    }
    best = preferDecoration(best, next)
  }
  return best
}

export const decorationClass = (decoration: GitFileDecoration): string =>
  DECORATION_CLASS[decoration]

export const decorationNameClass = (decoration: GitFileDecoration): string => {
  if (decoration === 'untracked') {
    return `${DECORATION_CLASS[decoration]} italic`
  }
  if (decoration === 'deleted') {
    return `${DECORATION_CLASS[decoration]} line-through`
  }
  if (decoration === 'ignored') {
    return `${DECORATION_CLASS[decoration]} font-normal`
  }
  return DECORATION_CLASS[decoration]
}

export const decorationLetter = (decoration: GitFileDecoration): string =>
  DECORATION_LETTER[decoration]

export const decorationLabel = (decoration: GitFileDecoration): string =>
  DECORATION_LABEL[decoration]

export const hasDecorationLetter = (decoration: GitFileDecoration): boolean =>
  DECORATION_LETTER[decoration].length > 0

const ancestorDirectoryPaths = (path: string): string[] => {
  const segments = normalizePath(path).split('/').filter(Boolean)
  if (segments.length <= 1) {
    return []
  }
  const ancestors: string[] = []
  for (let index = 0; index < segments.length - 1; index += 1) {
    ancestors.push(segments.slice(0, index + 1).join('/'))
  }
  return ancestors
}

const isUnderIgnoredRoot = (
  path: string,
  ignoredRoots: readonly string[],
): boolean => {
  for (const root of ignoredRoots) {
    if (path === root || path.startsWith(`${root}/`)) {
      return true
    }
  }
  return false
}

export const resolvePathDecoration = (
  path: string,
  byPath: Map<string, GitFileDecoration>,
  folderByPath: Map<string, GitFileDecoration>,
  ignoredRoots: readonly string[],
  kind: 'file' | 'folder',
): GitFileDecoration | null => {
  const direct =
    kind === 'folder'
      ? (folderByPath.get(path) ?? byPath.get(path) ?? null)
      : (byPath.get(path) ?? null)

  if (direct && direct !== 'ignored') {
    return direct
  }
  if (direct === 'ignored' || isUnderIgnoredRoot(path, ignoredRoots)) {
    return 'ignored'
  }
  return null
}

export type GitDecorationMaps = {
  byPath: Map<string, GitFileDecoration>
  folderByPath: Map<string, GitFileDecoration>
  ignoredRoots: string[]
}

export default (entries: GitStatusEntry[]): GitDecorationMaps => {
  const byPath = new Map<string, GitFileDecoration>()
  const folderByPath = new Map<string, GitFileDecoration>()
  const ignoredRootSet = new Set<string>()

  for (const entry of entries) {
    const decoration = decorationFromEntry(entry)
    if (!decoration) {
      continue
    }
    const isDirectoryEntry = entry.path.endsWith('/')
    const path = normalizePath(entry.path)
    if (!path || path === '.') {
      continue
    }

    const existing = byPath.get(path) ?? null
    const next = preferDecoration(existing, decoration)
    if (next) {
      byPath.set(path, next)
      if (isDirectoryEntry || decoration === 'ignored') {
        folderByPath.set(
          path,
          preferDecoration(folderByPath.get(path) ?? null, next) ?? next,
        )
      }
    }

    if (decoration === 'ignored') {
      ignoredRootSet.add(path)
      // Ignored does not tint parent folders (matches VS Code).
      continue
    }

    for (const ancestor of ancestorDirectoryPaths(path)) {
      const folderExisting = folderByPath.get(ancestor) ?? null
      const folderNext = preferDecoration(folderExisting, decoration)
      if (folderNext) {
        folderByPath.set(ancestor, folderNext)
      }
    }
  }

  const ignoredRoots = Array.from(ignoredRootSet).sort(
    (left, right) => right.length - left.length,
  )

  return { byPath, folderByPath, ignoredRoots }
}
