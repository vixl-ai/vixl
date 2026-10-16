import { workspaceGlob } from '@/services/vixl/vixl-tauri'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import { hasGroupMembers, isLiveMemberRoot } from '@/utils/parse-member-qualified-name'

const DEFAULT_LIMIT = 40

const fileName = (path: string): string => {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(slash + 1) : path
}

const escapeGlob = (value: string): string =>
  value.replace(/[\\*?[\]]/g, '\\$&')

const normalizeQuery = (value: string): string =>
  value.trim().replace(/\s+/g, '*')

const rankFiles = (paths: string[], rawQuery: string): string[] => {
  const needle = rawQuery.trim().toLowerCase()
  if (!needle) {
    return paths
  }

  return [...paths].sort((left, right) => {
    const leftName = fileName(left).toLowerCase()
    const rightName = fileName(right).toLowerCase()
    const leftNameMatch = leftName.includes(needle)
    const rightNameMatch = rightName.includes(needle)
    if (leftNameMatch !== rightNameMatch) {
      return leftNameMatch ? -1 : 1
    }
    const leftPath = left.toLowerCase()
    const rightPath = right.toLowerCase()
    const leftPathMatch = leftPath.includes(needle)
    const rightPathMatch = rightPath.includes(needle)
    if (leftPathMatch !== rightPathMatch) {
      return leftPathMatch ? -1 : 1
    }
    return left.localeCompare(right)
  })
}

const projectRootsForSearch = (
  members: HarnessWorkspaceMember[] | undefined,
): Array<{ slug: string; path: string }> | undefined => {
  if (!hasGroupMembers(members)) {
    return undefined
  }
  return members
    .filter((member) => isLiveMemberRoot(member.rootPath))
    .map((member) => ({
      slug: member.slug,
      path: member.rootPath,
    }))
}

const searchWorkspaceFiles = async (
  projectRoot: string | null | undefined,
  rawQuery: string,
  limit = DEFAULT_LIMIT,
  members?: HarnessWorkspaceMember[],
): Promise<string[]> => {
  if (!projectRoot) {
    return []
  }

  const normalized = normalizeQuery(rawQuery)
  const pattern = normalized ? `*${escapeGlob(normalized)}*` : '*'
  const projectRoots = projectRootsForSearch(members)

  const result = await workspaceGlob(projectRoot, pattern, limit, projectRoots)
  return rankFiles(
    result.files.map((entry) => entry.path),
    rawQuery,
  )
}

export default searchWorkspaceFiles
