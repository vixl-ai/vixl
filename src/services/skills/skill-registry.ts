import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import type { LoadedSkill, SkillIndexEntry } from '@/types/skills/skill'
import {
  listInternalCommandSkillIndex,
  listInternalSkillIndex,
  loadInternalSkill,
} from '@/services/skills/discover-internal-skills'
import {
  discoverProjectSkillIndex,
  loadProjectSkill,
} from '@/services/skills/discover-project-skills'
import { discoverUserSkillIndex, loadUserSkill } from '@/services/skills/discover-user-skills'
import isReservedSlashName from '@/services/skills/is-reserved-slash-name'
import { MAX_SKILL_CONTENT_CHARS } from '@/services/skills/strip-skill-frontmatter'

const overlaySkillIndex = (
  byName: Map<string, SkillIndexEntry>,
  skills: SkillIndexEntry[],
  protectedNames?: Set<string>,
): void => {
  for (const skill of skills) {
    const key = skill.name.toLowerCase()
    if (protectedNames?.has(key)) {
      continue
    }
    byName.set(key, skill)
  }
}

export const listUserAndProjectSkillIndex = async (
  projectRoot: string,
): Promise<SkillIndexEntry[]> => {
  const user = await discoverUserSkillIndex()
  const project = await discoverProjectSkillIndex(projectRoot)
  const byName = new Map<string, SkillIndexEntry>()
  overlaySkillIndex(byName, user)
  overlaySkillIndex(byName, project)
  return [...byName.values()]
}

const loadSkillIndexSafely = async (
  load: () => Promise<SkillIndexEntry[]>,
): Promise<SkillIndexEntry[]> => {
  try {
    return await load()
  } catch {
    return []
  }
}

export const listSlashSkillIndex = async (
  projectRoot: string | null,
): Promise<SkillIndexEntry[]> => {
  const commandSkills = listInternalCommandSkillIndex()
  const protectedNames = new Set(commandSkills.map((skill) => skill.name.toLowerCase()))
  const byName = new Map<string, SkillIndexEntry>()
  overlaySkillIndex(byName, commandSkills)
  overlaySkillIndex(byName, await loadSkillIndexSafely(discoverUserSkillIndex), protectedNames)
  if (projectRoot) {
    overlaySkillIndex(
      byName,
      await loadSkillIndexSafely(() => discoverProjectSkillIndex(projectRoot)),
      protectedNames,
    )
  }
  return [...byName.values()].filter((skill) => !isReservedSlashName(skill.name))
}

export const listStandaloneSkillIndex = async (
  mode: VixlChatMode,
  projectRoot: string,
): Promise<SkillIndexEntry[]> => {
  const commandSkills = listInternalCommandSkillIndex()
  const protectedNames = new Set(commandSkills.map((skill) => skill.name.toLowerCase()))
  const byName = new Map<string, SkillIndexEntry>()
  overlaySkillIndex(byName, commandSkills)
  overlaySkillIndex(byName, listInternalSkillIndex(mode))
  overlaySkillIndex(
    byName,
    await loadSkillIndexSafely(() => discoverProjectSkillIndex(projectRoot)),
    protectedNames,
  )
  return [...byName.values()]
}

export const listSkillIndex = async (
  mode: VixlChatMode,
  projectRoot: string,
): Promise<SkillIndexEntry[]> => {
  const commandSkills = listInternalCommandSkillIndex()
  const protectedNames = new Set(commandSkills.map((skill) => skill.name.toLowerCase()))
  const byName = new Map<string, SkillIndexEntry>()
  overlaySkillIndex(byName, commandSkills)
  overlaySkillIndex(byName, listInternalSkillIndex(mode))
  overlaySkillIndex(byName, await loadSkillIndexSafely(discoverUserSkillIndex), protectedNames)
  overlaySkillIndex(
    byName,
    await loadSkillIndexSafely(() => discoverProjectSkillIndex(projectRoot)),
    protectedNames,
  )
  return [...byName.values()]
}

export const loadSkill = async (
  name: string,
  projectRoot: string,
): Promise<LoadedSkill | { error: string }> => {
  const normalized = name.trim().toLowerCase()
  if (!normalized) {
    return { error: 'Skill name is required' }
  }

  const internal = loadInternalSkill(normalized)
  const project = internal ? null : await loadProjectSkill(projectRoot, normalized)
  const user = internal || project ? null : await loadUserSkill(normalized)
  const resolved = internal ?? project ?? user

  if (!resolved) {
    return { error: `Skill '${name}' not found` }
  }

  const scope = internal ? 'internal' : project ? 'project' : 'user'
  let content = resolved.content
  let truncated = false
  if (content.length > MAX_SKILL_CONTENT_CHARS) {
    content = `${content.slice(0, MAX_SKILL_CONTENT_CHARS)}\n\n[Skill content truncated, ${content.length - MAX_SKILL_CONTENT_CHARS} more characters omitted]`
    truncated = true
  }

  return {
    name: normalized,
    description: resolved.description,
    scope,
    skillDirectory: resolved.skillDirectory,
    content,
    truncated,
  }
}
