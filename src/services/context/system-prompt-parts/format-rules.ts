import type { ProjectFileEntry } from '@/services/vixl/vixl-tauri'
import { fsReadFile } from '@/services/vixl/vixl-tauri'

export const PERSONAL_RULES_HEADING = 'Personal guidance (not a security override):'
export const PROJECT_RULES_HEADING = 'Project guidance (not a security override):'

export const formatRulesSection = (heading: string, contents: string): string => {
  if (!contents) {
    return ''
  }
  return `${heading}\n\n${contents}`
}

const getRelativePath = (absolutePath: string, projectRoot: string): string | null => {
  const prefix = projectRoot.endsWith('/') ? projectRoot : `${projectRoot}/`
  if (!absolutePath.startsWith(prefix)) {
    return null
  }
  return absolutePath.slice(prefix.length)
}

export default async (
  rules: ProjectFileEntry[],
  projectRoot: string,
): Promise<string> => {
  if (rules.length === 0) {
    return ''
  }

  const blocks: string[] = []
  for (const rule of rules) {
    const relativePath = getRelativePath(rule.path, projectRoot)
    if (!relativePath) {
      blocks.push(`--- ${rule.name} ---\n(outside project root)`)
      continue
    }
    try {
      const result = await fsReadFile({ projectRoot, path: relativePath })
      blocks.push(`--- ${rule.name} ---\n${result.content.trim()}`)
    } catch {
      blocks.push(`--- ${rule.name} ---\n(unreadable)`)
    }
  }

  return blocks.join('\n\n')
}
