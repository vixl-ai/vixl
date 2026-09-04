import type { ProjectFileEntry } from '@/services/vixl/vixl-tauri'
import { fsReadFile } from '@/services/vixl/vixl-tauri'

const getRelativePath = (absolutePath: string, projectRoot: string): string | null => {
  const prefix = projectRoot.endsWith('/') ? projectRoot : `${projectRoot}/`
  if (!absolutePath.startsWith(prefix)) {
    return null
  }
  return absolutePath.slice(prefix.length)
}

export default async (
  entries: ProjectFileEntry[],
  projectRoot: string,
): Promise<string> => {
  const entry = entries[0]
  if (!entry) {
    return ''
  }

  const relativePath = getRelativePath(entry.path, projectRoot)
  if (!relativePath) {
    return `--- ${entry.name} ---\n(outside project root)`
  }

  try {
    const result = await fsReadFile({ projectRoot, path: relativePath })
    return `--- ${entry.name} ---\n${result.content.trim()}`
  } catch {
    return `--- ${entry.name} ---\n(unreadable)`
  }
}
