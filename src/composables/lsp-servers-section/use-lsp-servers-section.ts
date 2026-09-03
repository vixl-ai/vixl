import { computed, onMounted, onUnmounted, ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import {
  Ban,
  Download,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import useVixlConfig from '@/composables/use-vixl-config'
import {
  isTauri,
  lspCatalog,
  lspInstallServer,
  lspPrefetchDefaults,
  lspSetServerDisabled,
  lspUninstallServer,
  type LspCatalogEntry,
} from '@/services/vixl/vixl-tauri'
import useFleetRegistry from '@/composables/use-fleet-registry'
import formatUnknownError from '@/utils/format-unknown-error'
import lspServerIconName from '@/utils/lsp-server-icon-name'
import { buildStatusBadges } from './status-badges'


export default () => {
  const config = useVixlConfig()
  const fleet = useFleetRegistry()
  const catalog = ref<LspCatalogEntry[]>([])
  const installMessage = ref<string | null>(null)
  const busyIds = ref<Set<string>>(new Set())
  const prefetching = ref(false)
  let unlistenInstall: (() => void) | null = null

  const autoDownload = computed(
    () => config.personalSettings.value['lsp.autoDownload'] ?? true,
  )

  const activeRoot = computed(() => fleet.activeProject.value?.rootPath ?? null)

  const workspaceTrusted = computed(() => {
    const root = activeRoot.value
    if (!root) {
      return false
    }
    const records = config.effectiveSettings.value['workspace.trust'] ?? []
    return records.some((record) => record.rootPath === root && record.trusted)
  })

  const setBusy = (serverId: string, busy: boolean): void => {
    const next = new Set(busyIds.value)
    if (busy) {
      next.add(serverId)
    } else {
      next.delete(serverId)
    }
    busyIds.value = next
  }

  const isBusy = (serverId: string): boolean => busyIds.value.has(serverId)

  const refreshCatalog = async (): Promise<void> => {
    if (!isTauri()) {
      return
    }
    try {
      catalog.value = await lspCatalog()
    } catch (error) {
      toast.error('Failed to load language servers', {
        description: formatUnknownError(error),
      })
    }
  }

  const updateAutoDownload = async (value: boolean): Promise<void> => {
    try {
      await config.updateSetting('personal', 'lsp.autoDownload', value)
    } catch (error) {
      toast.error('Failed to save auto-download setting', {
        description: formatUnknownError(error),
      })
    }
  }

  const trustWorkspace = async (): Promise<void> => {
    const root = activeRoot.value
    if (!root) {
      toast.error('No active project to trust')
      return
    }
    const existing = config.effectiveSettings.value['workspace.trust'] ?? []
    const next = [
      ...existing.filter((record) => record.rootPath !== root),
      { rootPath: root, trusted: true },
    ]
    try {
      await config.updateSetting('personal', 'workspace.trust', next)
      toast.success('Workspace trusted for project-local language tools')
    } catch (error) {
      toast.error('Failed to save workspace trust', {
        description: formatUnknownError(error),
      })
    }
  }

  const extensionsHint = (entry: LspCatalogEntry): string =>
    entry.extensions.slice(0, 6).join(', ')

  const statusBadges = (entry: LspCatalogEntry) =>
    buildStatusBadges(entry, workspaceTrusted.value)

  const installServer = async (serverId: string): Promise<void> => {
    setBusy(serverId, true)
    try {
      await lspInstallServer(serverId)
      await refreshCatalog()
      toast.success(`Installed ${serverId}`)
    } catch (error) {
      toast.error(`Failed to install ${serverId}`, {
        description: formatUnknownError(error),
      })
    } finally {
      setBusy(serverId, false)
    }
  }

  const uninstallServer = async (serverId: string): Promise<void> => {
    setBusy(serverId, true)
    try {
      await lspUninstallServer(serverId)
      await refreshCatalog()
      toast.success(`Uninstalled ${serverId}`)
    } catch (error) {
      toast.error(`Failed to uninstall ${serverId}`, {
        description: formatUnknownError(error),
      })
    } finally {
      setBusy(serverId, false)
    }
  }

  const setDisabled = async (serverId: string, disabled: boolean): Promise<void> => {
    setBusy(serverId, true)
    try {
      await lspSetServerDisabled(serverId, disabled)
      await refreshCatalog()
      toast.success(disabled ? `Disabled ${serverId}` : `Enabled ${serverId}`)
    } catch (error) {
      toast.error(`Failed to update ${serverId}`, {
        description: formatUnknownError(error),
      })
    } finally {
      setBusy(serverId, false)
    }
  }

  const prefetchDefaults = async (): Promise<void> => {
    prefetching.value = true
    try {
      await lspPrefetchDefaults()
      toast.success('Installing default language support')
    } catch (error) {
      toast.error('Failed to start language support install', {
        description: formatUnknownError(error),
      })
    } finally {
      prefetching.value = false
    }
  }

  onMounted(async () => {
    await refreshCatalog()
    if (!isTauri()) {
      return
    }
    try {
      unlistenInstall = await listen<{
        serverId: string
        state: string
        message?: string | null
      }>('lsp://install', (event) => {
        installMessage.value = event.payload.message ?? `${event.payload.serverId}: ${event.payload.state}`
        if (event.payload.state === 'ready' || event.payload.state === 'error') {
          refreshCatalog().then(() => undefined).catch((error: unknown) => {
            toast.error('Failed to refresh language servers', {
              description: formatUnknownError(error),
            })
          })
        }
      })
    } catch (error) {
      toast.error('Failed to listen for language server installs', {
        description: formatUnknownError(error),
      })
    }
  })

  onUnmounted(() => {
    unlistenInstall?.()
    unlistenInstall = null
  })
  return {
    catalog,
    installMessage,
    prefetching,
    autoDownload,
    activeRoot,
    workspaceTrusted,
    isBusy,
    extensionsHint,
    statusBadges,
    installServer,
    uninstallServer,
    setDisabled,
    prefetchDefaults,
    updateAutoDownload,
    trustWorkspace,
    lspServerIconName,
    isTauri,
    // Icons used by template
    Ban,
    Download,
    Loader2,
    Play,
    RotateCcw,
    ShieldCheck,
    Trash2,
  }
}
