import { fsReadFile, listVixlFiles } from '@/services/vixl/vixl-tauri'
import type { SkillIndexEntry } from '@/types/skills/skill'
import parseSkillFrontmatter from '@/services/skills/strip-skill-frontmatter'

export const discoverProjectSkillIndex = async (
  projectRoot: string,
): Promise<SkillIndexEntry[]> => {
  const files = await listVixlFiles('project', 'skills', projectRoot).catch(() => [])
  return files.map((file) => ({
    name: file.name,
    description: file.description ?? '',
    scope: 'project' as const,
  }))
}

export const loadProjectSkill = async (
  projectRoot: string,
  name: string,
): Promise<{ skillDirectory: string; content: string; description: string } | null> => {
  const files = await listVixlFiles('project', 'skills', projectRoot).catch(() => [])
  const match = files.find((file) => file.name.toLowerCase() === name.toLowerCase())
  if (!match) {
    return null
  }

  const relativePath = `.vixl/skills/${match.name}/SKILL.md`

  const result = await fsReadFile({ projectRoot, path: relativePath })
  const { frontmatter, body } = parseSkillFrontmatter(result.content)
  const directory = relativePath.replace(/\/SKILL\.md$/, '')

  return {
    skillDirectory: directory,
    content: body,
    description: frontmatter.description ?? match.description ?? '',
  }
}
