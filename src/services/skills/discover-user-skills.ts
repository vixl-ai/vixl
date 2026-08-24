import { fsReadFile, getVixlDir, listVixlFiles } from '@/services/vixl/vixl-tauri'
import type { SkillIndexEntry } from '@/types/skills/skill'
import parseSkillFrontmatter from '@/services/skills/strip-skill-frontmatter'

export const discoverUserSkillIndex = async (): Promise<SkillIndexEntry[]> => {
  const files = await listVixlFiles('personal', 'skills').catch(() => [])
  return files.map((file) => ({
    name: file.name,
    description: file.description ?? '',
    scope: 'user' as const,
  }))
}

export const loadUserSkill = async (
  name: string,
): Promise<{ skillDirectory: string; content: string; description: string } | null> => {
  const files = await listVixlFiles('personal', 'skills').catch(() => [])
  const match = files.find((file) => file.name.toLowerCase() === name.toLowerCase())
  if (!match) {
    return null
  }

  const personalDir = await getVixlDir('personal')
  const relativePath = `skills/${match.name}/SKILL.md`
  const result = await fsReadFile({ projectRoot: personalDir, path: relativePath })
  const { frontmatter, body } = parseSkillFrontmatter(result.content)
  const directory = relativePath.replace(/\/SKILL\.md$/, '')

  return {
    skillDirectory: directory,
    content: body,
    description: frontmatter.description ?? match.description ?? '',
  }
}
