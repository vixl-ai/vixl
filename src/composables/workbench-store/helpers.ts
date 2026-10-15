import type { FleetProject } from '@/types/fleet/fleet-project'
import type { WorkbenchTab } from '@/types/workbench/workbench-tab'
import useFleetRegistry, {
  getFleetGroups,
  getFleetProjects,
} from '@/composables/use-fleet-registry'
import { primaryProjectForSlug } from '@/utils/primary-project-for-slug'
import { getUserHomeDir } from '@/services/vixl/vixl-tauri'
import { HOME_WORKSPACE_ID, isHomeChatSlug } from '@/constants/home-chat'
import {
  activeTabId,
  homeRoot,
  homeRootPath,
  rightSidebarOpen,
  tabs,
  workspaceFileReloadNonce,
  workspaceFileReloadPaths,
} from './state'

export const createId = (): string => crypto.randomUUID()

export const ensureHomeRoot = async (): Promise<string> => {
  if (homeRootPath.value) {
    return homeRootPath.value
  }
  if (!homeRoot.promise) {
    homeRoot.promise = getUserHomeDir()
      .then((root) => {
        homeRootPath.value = root
        return root
      })
      .catch((error) => {
        homeRoot.promise = null
        throw error
      })
  }
  return homeRoot.promise
}

export const createHomeProject = (rootPath: string): FleetProject => ({
  id: HOME_WORKSPACE_ID,
  name: 'Home',
  slug: HOME_WORKSPACE_ID,
  rootPath,
  lastOpened: '',
})

export const getProject = (projectId: string): FleetProject | null => {
  if (isHomeChatSlug(projectId)) {
    if (!homeRootPath.value) {
      return null
    }
    return createHomeProject(homeRootPath.value)
  }
  const fleet = useFleetRegistry()
  return fleet.projects.value.find((p) => p.id === projectId) ?? null
}

export const resolveWorkspaceProjectId = (): string => {
  const fleet = useFleetRegistry()
  return fleet.activeProjectId.value ?? HOME_WORKSPACE_ID
}

export const resolveProjectIdByRoot = (projectRoot: string): string | null => {
  if (homeRootPath.value && projectRoot === homeRootPath.value) {
    return HOME_WORKSPACE_ID
  }
  const fleet = useFleetRegistry()
  return fleet.projects.value.find((p) => p.rootPath === projectRoot)?.id ?? null
}

export const resolveProjectIdBySlug = (slug: string): string | null => {
  if (isHomeChatSlug(slug)) {
    return HOME_WORKSPACE_ID
  }
  const fleet = useFleetRegistry()
  return primaryProjectForSlug(slug, fleet.projects.value, fleet.groups?.value ?? [])?.id ?? null
}

export const listGroupMemberProjects = (groupSlug: string): FleetProject[] => {
  const group = getFleetGroups().find((entry) => entry.slug === groupSlug)
  if (!group) {
    return []
  }
  const bySlug = new Map(getFleetProjects().map((project) => [project.slug, project]))
  const members: FleetProject[] = []
  for (const memberSlug of group.memberSlugs) {
    const project = bySlug.get(memberSlug)
    if (project) {
      members.push(project)
    }
  }
  return members
}

export const listWorkspaceProjects = (contextSlug?: string | null): FleetProject[] => {
  const slug = contextSlug?.trim() ?? ''
  if (slug) {
    const members = listGroupMemberProjects(slug)
    if (members.length > 0) {
      return members
    }
    if (isHomeChatSlug(slug)) {
      const home = getProject(HOME_WORKSPACE_ID)
      return home ? [home] : []
    }
    const direct = getFleetProjects().find((project) => project.slug === slug)
    if (direct) {
      return [direct]
    }
  }
  const project = getProject(resolveWorkspaceProjectId())
  return project ? [project] : []
}

export const resolvePrimaryWorkspaceProjectId = (
  contextSlug?: string | null,
): string => listWorkspaceProjects(contextSlug)[0]?.id ?? resolveWorkspaceProjectId()

export const ensureSidebarOpen = (): void => {
  rightSidebarOpen.value = true
}

export const focusTab = (id: string): void => {
  if (!tabs.value.some((tab) => tab.id === id)) {
    return
  }
  activeTabId.value = id
  ensureSidebarOpen()
}

export const findTab = (
  predicate: (tab: WorkbenchTab) => boolean,
): WorkbenchTab | undefined => tabs.value.find(predicate)

export const updateTab = (id: string, patch: Partial<WorkbenchTab>): void => {
  const index = tabs.value.findIndex((tab) => tab.id === id)
  if (index < 0) {
    return
  }
  tabs.value[index] = { ...tabs.value[index]!, ...patch }
}

export const setRightSidebarOpen = (open: boolean): void => {
  rightSidebarOpen.value = open
}

export const toggleRightSidebar = (): void => {
  rightSidebarOpen.value = !rightSidebarOpen.value
}

export const reloadWorkspaceFiles = (paths: string[]): void => {
  const unique = [...new Set(paths.filter(Boolean))]
  if (unique.length === 0) {
    return
  }
  workspaceFileReloadPaths.value = unique
  workspaceFileReloadNonce.value += 1
}
