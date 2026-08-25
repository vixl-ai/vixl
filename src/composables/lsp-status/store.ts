import { computed, onMounted, watch } from 'vue'
import type { LspHealth, LspProblemItem, LspStatusServerRow } from '@/types/lsp/lsp-status'
import useFleetRegistry from '@/composables/use-fleet-registry'
import { normalizeFileUri } from '@/utils/monaco-lsp'
import { refreshCatalog, warmDefaults } from './catalog'
import {
  clearDiagnostics,
  countSeverity,
  fileUriToProjectPath,
  markAwaitingProjectLoad,
  toStatusRow,
} from './helpers'
import { bindListeners, unbindListeners } from './listeners'
import {
  awaitingProjectLoad,
  diagnosticsByUri,
  installMessage,
  prefetchBusy,
  servers,
  warming,
  warmState,
} from './state'

const useLspStatus = () => {
  const fleet = useFleetRegistry()
  const projectRoot = computed(() => fleet.activeProject.value?.rootPath ?? null)

  const statusRows = computed((): LspStatusServerRow[] =>
    servers.value.map(toStatusRow),
  )

  const visibleRows = computed((): LspStatusServerRow[] => {
    const busy = prefetchBusy.value || warming.value
    return statusRows.value.filter((row) => {
      if (
        row.running ||
        row.displayState === 'installing' ||
        row.displayState === 'starting' ||
        row.displayState === 'needs_trust' ||
        row.displayState === 'error'
      ) {
        return true
      }
      if (busy && awaitingProjectLoad.value.has(row.id)) {
        return true
      }
      return false
    })
  })

  const errorCount = computed(() => countSeverity(1))
  const warningCount = computed(() => countSeverity(2))

  const hasServerErrors = computed(() =>
    statusRows.value.some((row) => row.displayState === 'error' || Boolean(row.error)),
  )

  const isBusy = computed(
    () =>
      prefetchBusy.value ||
      warming.value ||
      awaitingProjectLoad.value.size > 0 ||
      statusRows.value.some(
        (row) => row.displayState === 'installing' || row.displayState === 'starting',
      ),
  )

  const health = computed((): LspHealth => {
    if (isBusy.value) {
      return 'busy'
    }
    if (hasServerErrors.value || errorCount.value > 0) {
      return 'error'
    }
    if (warningCount.value > 0) {
      return 'warning'
    }
    return 'ok'
  })

  const problems = computed((): LspProblemItem[] => {
    const root = projectRoot.value
    const items: LspProblemItem[] = []
    for (const [uri, diagnostics] of diagnosticsByUri.value.entries()) {
      const path = root ? fileUriToProjectPath(uri, root) : null
      const displayPath = path ?? normalizeFileUri(uri)
      for (const [index, diagnostic] of diagnostics.entries()) {
        if (diagnostic.severity !== 1 && diagnostic.severity !== 2) {
          continue
        }
        const line = (diagnostic.range?.start.line ?? 0) + 1
        const character = (diagnostic.range?.start.character ?? 0) + 1
        items.push({
          id: `${uri}:${index}:${line}:${character}`,
          uri,
          path: displayPath,
          message: diagnostic.message,
          severity: diagnostic.severity === 1 ? 'error' : 'warning',
          line,
          character,
        })
      }
    }
    return items.sort((left, right) => {
      if (left.severity !== right.severity) {
        return left.severity === 'error' ? -1 : 1
      }
      const byPath = left.path.localeCompare(right.path)
      if (byPath !== 0) {
        return byPath
      }
      return left.line - right.line
    })
  })

  watch(projectRoot, (root, previous) => {
    if (root !== previous) {
      clearDiagnostics()
      warmState.lastWarmedRoot = null
      awaitingProjectLoad.value = new Set()
    }
    if (!root) {
      servers.value = []
      return
    }
    refreshCatalog()
      .then(async () => {
        if (root !== projectRoot.value) {
          return
        }
        await warmDefaults(root)
      })
      .catch((error: unknown) => {
        installMessage.value =
          error instanceof Error ? error.message : 'Failed to load language servers'
      })
  })

  onMounted(() => {
    const start = async (): Promise<void> => {
      await bindListeners(projectRoot)
      await refreshCatalog()
      const root = projectRoot.value
      if (!root) {
        return
      }
      await warmDefaults(root)
    }
    start().catch((error: unknown) => {
      installMessage.value =
        error instanceof Error ? error.message : 'Failed to start language status'
    })
  })

  return {
    servers: statusRows,
    visibleRows,
    problems,
    errorCount,
    warningCount,
    hasServerErrors,
    isBusy,
    health,
    installMessage,
    projectRoot,
    refreshCatalog,
    warmDefaults,
    markAwaitingProjectLoad,
    clearDiagnostics,
    bindListeners: () => bindListeners(projectRoot),
    unbindListeners,
    fileUriToProjectPath,
  }
}

export default useLspStatus
