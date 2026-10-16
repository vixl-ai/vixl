import { computed, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { FleetProject } from '@/types/fleet/fleet-project'
import type { FleetProjectGroup } from '@/types/fleet/fleet-project-group'
import ensureCodeGraph from '@/services/codegraph/ensure-codegraph'
import {
  getActiveProjectId,
  hasProjectVixl,
  isTauri,
  lspPrefetchDefaults,
  registryAddGroup,
  registryListGroups,
  registryListProjects,
  registryRemoveGroup,
  registryRemoveProject,
  registrySetActiveProject,
  registryUpdateGroup,
} from '@/services/vixl/vixl-tauri'
import formatUnknownError from '@/utils/format-unknown-error'
import { setFleetGroupReader } from '@/utils/fleet-group-reader'
import {
  isGroupSlug,
  primaryProjectForSlug as resolvePrimaryProjectForSlug,
} from '@/utils/primary-project-for-slug'

const projects = ref<FleetProject[]>([])
const groups = ref<FleetProjectGroup[]>([])
setFleetGroupReader(() => groups.value)
const activeProjectId = ref<string | null>(null)
const hasProjectVixlFlag = ref(false)
const loaded = ref(false)
let bootstrapPromise: Promise<void> | null = null

const mapProject = (record: {
  id: string
  name: string
  slug: string
  root_path: string
  last_opened: string
}): FleetProject => ({
  id: record.id,
  name: record.name,
  slug: record.slug,
  rootPath: record.root_path,
  lastOpened: record.last_opened,
})

const mapGroup = (record: {
  id: string
  name: string
  slug: string
  member_slugs: string[]
  last_opened: string
}): FleetProjectGroup => ({
  id: record.id,
  name: record.name,
  slug: record.slug,
  memberSlugs: record.member_slugs,
  lastOpened: record.last_opened,
})

const refreshHasVixl = async (): Promise<void> => {
  const project = projects.value.find((entry) => entry.id === activeProjectId.value) ?? null
  if (!project) {
    hasProjectVixlFlag.value = false
    return
  }
  hasProjectVixlFlag.value = await hasProjectVixl(project.rootPath)
}

const refresh = async (): Promise<void> => {
  const [projectRecords, groupRecords] = await Promise.all([
    registryListProjects(),
    registryListGroups(),
  ])
  projects.value = projectRecords.map(mapProject)
  groups.value = groupRecords.map(mapGroup)
  const persistedActiveId = await getActiveProjectId()
  activeProjectId.value =
    persistedActiveId && projects.value.some((project) => project.id === persistedActiveId)
      ? persistedActiveId
      : null
  await refreshHasVixl()
  loaded.value = true
}

export const getFleetProjects = (): FleetProject[] => projects.value

export const getFleetGroups = (): FleetProjectGroup[] => groups.value

export const isFleetGroupSlug = (slug: string): boolean =>
  isGroupSlug(slug, groups.value)

export const primaryProjectForSlug = (slug: string): FleetProject | null =>
  resolvePrimaryProjectForSlug(slug, projects.value, groups.value)

export const isFleetLoaded = (): boolean => loaded.value

export const ensureFleetLoaded = async (): Promise<void> => {
  if (loaded.value) {
    return
  }
  if (!bootstrapPromise) {
    bootstrapPromise = refresh().finally(() => {
      bootstrapPromise = null
    })
  }
  await bootstrapPromise
}

export default () => {
  const activeProject = computed(
    () => projects.value.find((p) => p.id === activeProjectId.value) ?? null,
  )

  // Auto-start: Graph chip owns MCP serverState.error. Do not toast.
  const ensureGraphQuietly = async (root: string): Promise<void> => {
    try {
      await ensureCodeGraph(root)
    } catch {
      return
    } finally {
      await refreshHasVixl()
    }
  }

  const setActiveProject = async (projectId: string | null): Promise<void> => {
    if (projectId === activeProjectId.value) {
      return
    }

    await registrySetActiveProject(projectId)
    activeProjectId.value = projectId
    await refreshHasVixl()
    if (projectId && isTauri()) {
      try {
        await lspPrefetchDefaults()
      } catch (error) {
        toast.error('Failed to prepare language support', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }

      const project = projects.value.find((entry) => entry.id === projectId)
      if (project) {
        // Do not block activation on CodeGraph connect; Graph UI polls status itself.
        ensureGraphQuietly(project.rootPath).catch((error: unknown) => {
          toast.error('Failed to check project configuration', {
            description: formatUnknownError(error),
          })
        })
      }
    }
  }

  const removeProject = async (projectId: string): Promise<void> => {
    await registryRemoveProject(projectId)
    await refresh()
  }

  const addGroup = async (
    memberSlugs: string[],
    name?: string | null,
  ): Promise<FleetProjectGroup> => {
    const record = await registryAddGroup(memberSlugs, name)
    await refresh()
    return mapGroup(record)
  }

  const updateGroup = async (
    groupId: string,
    name: string,
    memberSlugs: string[],
  ): Promise<FleetProjectGroup> => {
    const record = await registryUpdateGroup(groupId, name, memberSlugs)
    await refresh()
    return mapGroup(record)
  }

  const removeGroup = async (groupId: string): Promise<void> => {
    await registryRemoveGroup(groupId)
    await refresh()
  }

  // Keep an active selection when projects exist; never invent one from CWD.
  // An empty registry is valid: user adds via folder picker or home chat.
  const ensureDefaultProject = async (): Promise<void> => {
    if (projects.value.length === 0) {
      if (activeProjectId.value) {
        await setActiveProject(null)
      }
      return
    }
    if (
      !activeProjectId.value ||
      !projects.value.some((project) => project.id === activeProjectId.value)
    ) {
      await setActiveProject(projects.value[0]!.id)
      return
    }

    // Persisted active project: still ensure internal graph is up (setActiveProject was skipped).
    if (isTauri()) {
      const project = projects.value.find((entry) => entry.id === activeProjectId.value)
      if (project) {
        await ensureGraphQuietly(project.rootPath)
      }
    }
  }

  onMounted(() => {
    void (async () => {
      try {
        await ensureFleetLoaded()
        await ensureDefaultProject()
      } catch (error) {
        toast.error('Failed to load fleet registry', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    })()
  })

  return {
    projects,
    groups,
    activeProject,
    activeProjectId,
    hasProjectVixl: hasProjectVixlFlag,
    loaded,
    refresh,
    setActiveProject,
    removeProject,
    addGroup,
    updateGroup,
    removeGroup,
    ensureDefaultProject,
  }
}
