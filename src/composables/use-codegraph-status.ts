import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import useFleetRegistry from '@/composables/use-fleet-registry'
import normalizeCodegraphResult from '@/services/codegraph/normalize-codegraph-result'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import { isTauri } from '@/services/vixl/vixl-tauri'
import type { CodebaseStatusResult } from '@/types/codegraph/codebase-tool-result'
import { CODEGRAPH_SERVER_ID } from '@/types/codegraph/managed-codegraph'
import invokeErrorMessage from '@/utils/invoke-error-message'

export type CodegraphStatusState = 'idle' | 'indexing' | 'ready' | 'syncing' | 'error'

const IDLE_POLL_MS = 12_000
const BUSY_POLL_MS = 3_000

const state = ref<CodegraphStatusState>('idle')
const detail = ref<string | null>(null)
const errorMessage = ref<string | null>(null)
const statusResult = ref<CodebaseStatusResult | null>(null)
const pending = ref(false)
const connected = ref(false)

let refreshGeneration = 0
let pollTimer: ReturnType<typeof setTimeout> | null = null
let consumerCount = 0
let fleetWatchBound = false

const clearPollTimer = (): void => {
  if (pollTimer !== null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

const deriveState = (result: CodebaseStatusResult): CodegraphStatusState => {
  if (result.error) {
    return 'error'
  }
  if (result.indexing) {
    return 'indexing'
  }
  if (result.syncing) {
    return 'syncing'
  }
  if (result.ready) {
    return 'ready'
  }
  return 'idle'
}

const applyIdle = (message?: string | null): void => {
  state.value = 'idle'
  detail.value = message ?? null
  errorMessage.value = null
  statusResult.value = null
  connected.value = false
}

const applyError = (message: string, result?: CodebaseStatusResult | null): void => {
  state.value = 'error'
  errorMessage.value = message
  detail.value = result?.detail ?? message
  statusResult.value = result ?? null
}

const scheduleNextPoll = (refresh: () => Promise<void>): void => {
  clearPollTimer()
  if (consumerCount <= 0) {
    return
  }
  const busy =
    pending.value ||
    state.value === 'indexing' ||
    state.value === 'syncing'
  pollTimer = setTimeout(() => {
    pollTimer = null
    refresh().catch((error: unknown) => {
      if (!errorMessage.value) {
        errorMessage.value =
          error instanceof Error ? error.message : 'Failed to refresh CodeGraph status'
      }
    })
  }, busy ? BUSY_POLL_MS : IDLE_POLL_MS)
}

export default () => {
  const fleet = useFleetRegistry()
  const projectRoot = computed(() => fleet.activeProject.value?.rootPath ?? null)
  const projectSlug = computed(() => fleet.activeProject.value?.slug ?? null)

  const label = computed((): string => {
    switch (state.value) {
      case 'indexing':
        return 'Indexing'
      case 'syncing':
        return 'Syncing'
      case 'ready':
        return 'Ready'
      case 'error':
        return 'Error'
      case 'idle':
      default:
        return 'Offline'
    }
  })

  const isBusy = computed(
    () =>
      pending.value ||
      state.value === 'indexing' ||
      state.value === 'syncing',
  )

  const refreshNow = async (options?: { toastOnError?: boolean }): Promise<void> => {
    const generation = ++refreshGeneration
    const toastOnError = options?.toastOnError === true
    const root = projectRoot.value

    if (!isTauri() || !root) {
      applyIdle()
      pending.value = false
      scheduleNextPoll(() => refreshNow())
      return
    }

    pending.value = true
    try {
      const serverState = await mcpRuntime.getStatus(CODEGRAPH_SERVER_ID)
      if (generation !== refreshGeneration) {
        return
      }

      if (serverState.status === 'starting' || serverState.status === 'refreshing') {
        connected.value = false
        statusResult.value = null
        errorMessage.value = null
        state.value = 'indexing'
        detail.value =
          serverState.status === 'starting'
            ? 'Starting'
            : 'Refreshing'
        return
      }

      if (serverState.status !== 'connected') {
        connected.value = false
        statusResult.value = null
        if (serverState.error) {
          applyError(serverState.error)
        } else {
          applyIdle(
            serverState.status === 'stopped'
              ? 'Not running yet'
              : `Status: ${serverState.status}`,
          )
        }
        return
      }

      connected.value = true
      const raw = await mcpRuntime.callTool(CODEGRAPH_SERVER_ID, 'codegraph_status', {})
      if (generation !== refreshGeneration) {
        return
      }

      const result = normalizeCodegraphResult.status(raw)
      statusResult.value = result
      state.value = deriveState(result)
      detail.value = result.detail ?? null
      errorMessage.value = result.error ?? null
    } catch (error) {
      if (generation !== refreshGeneration) {
        return
      }
      const message = invokeErrorMessage(error)
      applyError(message === 'Unknown error' ? 'Failed to load Graph status' : message)
      if (toastOnError) {
        toast.error('Failed to load Graph status', {
          description: message,
        })
      }
    } finally {
      if (generation === refreshGeneration) {
        pending.value = false
        scheduleNextPoll(() => refreshNow())
      }
    }
  }

  const refresh = async (): Promise<void> => {
    await refreshNow({ toastOnError: true })
  }

  const bindFleetWatch = (): void => {
    if (fleetWatchBound) {
      return
    }
    fleetWatchBound = true
    watch(
      projectRoot,
      () => {
        refreshGeneration += 1
        clearPollTimer()
        refreshNow().catch((error: unknown) => {
          if (!errorMessage.value) {
            errorMessage.value =
              error instanceof Error ? error.message : 'Failed to load CodeGraph status'
          }
        })
      },
      { immediate: true },
    )
  }

  onMounted(() => {
    consumerCount += 1
    bindFleetWatch()
    if (consumerCount === 1 && !pollTimer) {
      scheduleNextPoll(() => refreshNow())
    }
  })

  onUnmounted(() => {
    consumerCount = Math.max(0, consumerCount - 1)
    if (consumerCount === 0) {
      clearPollTimer()
    }
  })

  return {
    state,
    label,
    detail,
    errorMessage,
    statusResult,
    pending,
    connected,
    isBusy,
    projectRoot,
    projectSlug,
    refresh,
  }
}
