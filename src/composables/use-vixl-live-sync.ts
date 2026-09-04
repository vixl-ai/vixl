import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { toast } from 'vue-sonner'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import useVixlConfig from '@/composables/use-vixl-config'
import useMcpServers from '@/composables/use-mcp-servers'
import useFleetRegistry from '@/composables/use-fleet-registry'
import { watchVixlPaths } from '@/services/vixl/vixl-tauri'

export type VixlFileKind =
  | 'settings'
  | 'mcp'
  | 'agents'
  | 'agents-md'
  | 'rules'
  | 'skills'
  | 'plans'
  | 'studio'

export type VixlFileChange = {
  scope: 'personal' | 'project'
  rootPath?: string | null
  kind: VixlFileKind
}

export const vixlFileChangeToken = ref(0)
export const lastVixlFileChange = shallowRef<VixlFileChange | null>(null)

export default () => {
  const config = useVixlConfig()
  const mcp = useMcpServers()
  const fleet = useFleetRegistry()

  let unlisten: UnlistenFn | null = null

  const syncWatcher = async (): Promise<void> => {
    await watchVixlPaths(config.activeRootPath.value)
  }

  const applyChange = async (change: VixlFileChange): Promise<void> => {
    lastVixlFileChange.value = change
    vixlFileChangeToken.value += 1

    if (change.kind === 'settings') {
      await config.refreshAll()
      return
    }

    if (change.kind === 'mcp') {
      await mcp.loadConfigs(config.activeRootPath.value)
      await mcp.refreshStates()
    }
  }

  const handleFileChanged = async (change: VixlFileChange): Promise<void> => {
    try {
      await applyChange(change)
    } catch (error) {
      toast.error('Failed to sync file change', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  onMounted(async () => {
    await fleet.refresh()
    await fleet.ensureDefaultProject()
    await config.refreshAll()
    await mcp.loadConfigs(config.activeRootPath.value)
    await mcp.refreshStates()
    await syncWatcher()

    unlisten = await listen<VixlFileChange>('vixl-file-changed', (event) => {
      const change = event.payload
      if (
        change.scope === 'project' &&
        change.rootPath &&
        change.rootPath !== config.activeRootPath.value
      ) {
        return
      }
      handleFileChanged(change)
    })
  })

  watch(
    () => config.activeRootPath.value,
    async (rootPath) => {
      await config.refreshAll()
      await mcp.loadConfigs(rootPath)
      await mcp.refreshStates()
      await syncWatcher()
    },
  )

  onUnmounted(() => {
    unlisten?.()
    unlisten = null
  })

  return {
    syncWatcher,
    applyChange,
  }
}
