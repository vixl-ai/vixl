import { workspaceGlob } from '@/services/vixl/vixl-tauri'

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

const searchWorkspaceFiles = async (
  projectRoot: string | null | undefined,
  rawQuery: string,
  limit = DEFAULT_LIMIT,
): Promise<string[]> => {
  if (!projectRoot) {
    return []
  }

  const normalized = normalizeQuery(rawQuery)
  const pattern = normalized ? `*${escapeGlob(normalized)}*` : '*'

  const result = await workspaceGlob(projectRoot, pattern, limit)
  return rankFiles(
    result.files.map((entry) => entry.path),
    rawQuery,
  )
}

export default searchWorkspaceFiles
