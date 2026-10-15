import {
  ensureFleetLoaded,
  getFleetGroups,
  getFleetProjects,
} from '@/composables/use-fleet-registry'
import { isHomeChatSlug } from '@/constants/home-chat'
import { lspEnsureServer, lspWorkspaceProfile } from '@/services/vixl/vixl-tauri'
import type {
  HarnessWorkspace,
  HarnessWorkspaceMember,
} from '@/types/harness/harness-workspace'

const resolveGroupMembers = async (
  workspace: HarnessWorkspace,
): Promise<HarnessWorkspaceMember[] | undefined> => {
  await ensureFleetLoaded()
  const group = getFleetGroups().find((entry) => entry.slug === workspace.projectSlug)
  if (!group) {
    return undefined
  }

  const projects = getFleetProjects()
  const members: HarnessWorkspaceMember[] = []
  for (const memberSlug of group.memberSlugs) {
    const project = projects.find((entry) => entry.slug === memberSlug)
    if (!project) {
      continue
    }
    members.push({
      slug: project.slug,
      name: project.name,
      rootPath: project.rootPath,
    })
  }

  return members.length > 0 ? members : undefined
}

const resolveLiveWorkspace = async (input: {
  workspace?: HarnessWorkspace
  projectSlug: string
  projectRoot: string
  projectName: string
  standalone?: boolean
}): Promise<HarnessWorkspace> => {
  const workspace: HarnessWorkspace = input.workspace ?? input
  const members = await resolveGroupMembers(workspace)
  if (members) {
    workspace.members = members
  } else if (isSingleRootSlug(workspace.projectSlug)) {
    workspace.members = undefined
  }
  await ensureMemberRuntimes(workspace)
  return workspace
}

const isSingleRootSlug = (slug: string): boolean => {
  if (getFleetGroups().some((entry) => entry.slug === slug)) {
    return false
  }
  if (isHomeChatSlug(slug)) {
    return true
  }
  return getFleetProjects().some((entry) => entry.slug === slug)
}

const uniqueMemberRoots = (workspace: HarnessWorkspace): string[] => {
  const members = workspace.members
  if (!members || members.length === 0) {
    return []
  }
  const roots: string[] = []
  const seen = new Set<string>()
  for (const member of members) {
    const root = member.rootPath.trim()
    if (!root || seen.has(root)) {
      continue
    }
    seen.add(root)
    roots.push(root)
  }
  return roots
}

const ensureLspForRoot = async (root: string): Promise<void> => {
  const profile = await lspWorkspaceProfile(root)
  await Promise.allSettled(
    profile.warmExtensions.map((extension) => lspEnsureServer(extension, root)),
  )
}

const ensureMemberRuntimes = async (workspace: HarnessWorkspace): Promise<void> => {
  const roots = uniqueMemberRoots(workspace)
  if (roots.length === 0) {
    return
  }
  const ensureCodeGraph = (await import('@/services/codegraph/ensure-codegraph')).default
  await Promise.allSettled(roots.map((root) => ensureCodeGraph(root)))
  await Promise.allSettled(roots.map((root) => ensureLspForRoot(root)))
}

export { resolveGroupMembers }
export default resolveLiveWorkspace
