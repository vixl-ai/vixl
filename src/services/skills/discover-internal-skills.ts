import type { SkillIndexEntry } from '@/types/skills/skill'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import parseSkillFrontmatter from '@/services/skills/strip-skill-frontmatter'

const skillModules = import.meta.glob('../../skills/**/SKILL.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const INTERNAL_SKILL_MODE_GATES: Record<string, VixlChatMode[]> = {
  ask: ['ask'],
  plan: ['plan'],
  agent: ['agent'],
  studio: ['studio'],
  'studio-blocks': ['studio'],
  orchestrator: ['orchestrator'],
}

const pathToSkillName = (path: string): string => {
  const parts = path.split('/')
  const skillsIndex = parts.indexOf('skills')
  if (skillsIndex === -1 || skillsIndex + 1 >= parts.length) {
    return 'unknown'
  }
  return parts[skillsIndex + 1] ?? 'unknown'
}

const internalSkills: SkillIndexEntry[] = Object.entries(skillModules).map(([path, raw]) => {
  const { frontmatter } = parseSkillFrontmatter(raw)
  const fallbackName = pathToSkillName(path)
  return {
    name: frontmatter.name ?? fallbackName,
    description: frontmatter.description ?? '',
    scope: 'internal',
  }
})

export default (): SkillIndexEntry[] => internalSkills

export const listInternalSkillIndex = (
  mode: VixlChatMode,
): SkillIndexEntry[] =>
  internalSkills.filter((skill) => {
    const modes = INTERNAL_SKILL_MODE_GATES[skill.name]
    if (!modes) {
      return true
    }
    return modes.includes(mode)
  })

export const loadInternalSkill = (name: string): {
  skillDirectory: string
  content: string
  description: string
} | null => {
  const normalized = name.toLowerCase()
  for (const [path, raw] of Object.entries(skillModules)) {
    const skillName = pathToSkillName(path)
    const { frontmatter, body } = parseSkillFrontmatter(raw)
    const resolvedName = (frontmatter.name ?? skillName).toLowerCase()
    if (resolvedName !== normalized && skillName.toLowerCase() !== normalized) {
      continue
    }
    const directory = path.replace(/\/SKILL\.md$/, '')
    return {
      skillDirectory: directory,
      content: body,
      description: frontmatter.description ?? '',
    }
  }
  return null
}
