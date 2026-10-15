import { isHomeWorkspaceRoot } from '@/services/config/is-home-workspace-root'
import {
  formatAmbiguousMemberOptions,
  hasGroupMembers,
  parseMemberQualifiedName,
} from '@/utils/parse-member-qualified-name'
import {
  discoverProjectSkillIndex,
  loadProjectSkill,
} from '@/services/skills/discover-project-skills'
import { loadInternalSkill } from '@/services/skills/discover-internal-skills'
import { loadUserSkill } from '@/services/skills/discover-user-skills'
import { loadSkill } from '@/services/skills/skill-registry'
import { MAX_SKILL_CONTENT_CHARS } from '@/services/skills/strip-skill-frontmatter'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import type { LoadedSkill } from '@/types/skills/skill'

const packLoadedSkill = (
  name: string,
  scope: LoadedSkill['scope'],
  resolved: { skillDirectory: string; content: string; description: string },
): LoadedSkill => {
  let content = resolved.content
  let truncated = false
  if (content.length > MAX_SKILL_CONTENT_CHARS) {
    content = `${content.slice(0, MAX_SKILL_CONTENT_CHARS)}\n\n[Skill content truncated, ${content.length - MAX_SKILL_CONTENT_CHARS} more characters omitted]`
    truncated = true
  }
  return {
    name: name.trim().toLowerCase(),
    description: resolved.description,
    scope,
    skillDirectory: resolved.skillDirectory,
    content,
    truncated,
  }
}

const membersWithProjectSkill = async (
  members: HarnessWorkspaceMember[],
  skillName: string,
): Promise<HarnessWorkspaceMember[]> => {
  const hits: HarnessWorkspaceMember[] = []
  for (const member of members) {
    if (await isHomeWorkspaceRoot(member.rootPath)) {
      continue
    }
    const index = await discoverProjectSkillIndex(member.rootPath).catch(() => [])
    if (index.some((skill) => skill.name.toLowerCase() === skillName)) {
      hits.push(member)
    }
  }
  return hits
}

export const loadSkillForWorkspace = async (
  name: string,
  projectRoot: string,
  members: HarnessWorkspaceMember[] | undefined,
): Promise<LoadedSkill | { error: string }> => {
  if (!hasGroupMembers(members)) {
    return loadSkill(name, projectRoot)
  }

  const qualified = parseMemberQualifiedName(name, members)
  if (qualified) {
    const project = await loadProjectSkill(qualified.member.rootPath, qualified.name)
    if (!project) {
      return { error: `Skill '${name}' not found` }
    }
    return packLoadedSkill(qualified.name, 'project', project)
  }

  const normalized = name.trim().toLowerCase()
  if (!normalized) {
    return { error: 'Skill name is required' }
  }

  const hits = await membersWithProjectSkill(members, normalized)
  if (hits.length > 1) {
    return {
      error: `Skill '${name}' is defined in multiple projects. Use one of: ${formatAmbiguousMemberOptions(hits, normalized)}`,
    }
  }

  const internal = loadInternalSkill(normalized)
  if (internal) {
    return loadSkill(normalized, projectRoot)
  }

  const user = await loadUserSkill(normalized)
  if (hits.length === 1 && !user) {
    const project = await loadProjectSkill(hits[0]!.rootPath, normalized)
    if (!project) {
      return { error: `Skill '${name}' not found` }
    }
    return packLoadedSkill(normalized, 'project', project)
  }

  return loadSkill(normalized, projectRoot)
}
