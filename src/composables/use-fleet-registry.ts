import { computed, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { FleetProject } from '@/types/fleet/fleet-project'
import useMcpServers from '@/composables/use-mcp-servers'
import ensureCodeGraph from '@/services/codegraph/ensure-codegraph'
import { sessionTrusts } from '@/services/mcp/mcp-trust'
import { CODEGRAPH_SERVER_ID } from '@/types/codegraph/managed-codegraph'
import {
  getActiveProjectId,
  hasProjectVixl,
  isTauri,
  lspPrefetchDefaults,
  registryListProjects,
  registryRemoveProject,
  registrySetActiveProject,
} from '@/services/vixl/vixl-tauri'
import formatUnknownError from '@/utils/format-unknown-error'

const projects = ref<FleetProject[]>([])
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

export default () => {
  const activeProject = computed(
    () => projects.value.find((p) => p.id === activeProjectId.value) ?? null,
  )

  const refreshHasVixl = async (): Promise<void> => {
    if (!activeProject.value) {
      hasProjectVixlFlag.value = false
      return
    }
    hasProjectVixlFlag.value = await hasProjectVixl(activeProject.value.rootPath)
  }

  const refresh = async (): Promise<void> => {
    const records = await registryListProjects()
    projects.value = records.map(mapProject)
    const persistedActiveId = await getActiveProjectId()
    activeProjectId.value =
      persistedActiveId && projects.value.some((project) => project.id === persistedActiveId)
        ? persistedActiveId
        : null
    await refreshHasVixl()
    loaded.value = true
  }

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

    // Tear down project-scoped MCP before switching so tools do not keep the old cwd/env.
    const mcp = useMcpServers()
    const effective = mcp.listEffectiveMcpServers(
      mcp.personalMcp.value,
      mcp.projectMcp.value,
    )
    for (const server of effective) {
      if (server.scope === 'project' || server.scope === 'overridden') {
        try {
          await mcp.stopServer(server.id, { quiet: true })
        } catch (error) {
          toast.error('Failed to stop project MCP server', {
            description: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    }
    try {
      await mcp.stopServer(CODEGRAPH_SERVER_ID, { quiet: true })
    } catch (error) {
      toast.error('Failed to stop graph', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
    sessionTrusts.clear()

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
        // Project MCP was stopped above; reload configs for the new root via ensure.
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
    if (loaded.value) {
      return
    }
    if (bootstrapPromise) {
      return
    }
    bootstrapPromise = (async () => {
      try {
        await refresh()
        await ensureDefaultProject()
      } catch (error) {
        toast.error('Failed to load fleet registry', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      } finally {
        bootstrapPromise = null
      }
    })()
  })

  return {
    projects,
    activeProject,
    activeProjectId,
    hasProjectVixl: hasProjectVixlFlag,
    loaded,
    refresh,
    setActiveProject,
    removeProject,
    ensureDefaultProject,
  }
}
