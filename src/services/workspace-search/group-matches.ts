import type { GrepMatch } from '@/services/vixl/vixl-tauri'
import type { SearchFileGroup } from '@/types/workbench/search-file-group'

export default (matches: GrepMatch[]): SearchFileGroup[] => {
  const order: string[] = []
  const byPath = new Map<string, GrepMatch[]>()

  for (const match of matches) {
    const existing = byPath.get(match.path)
    if (existing) {
      existing.push(match)
      continue
    }
    byPath.set(match.path, [match])
    order.push(match.path)
  }

  return order.map((path) => ({
    path,
    hits: byPath.get(path) ?? [],
  }))
}
