import { computed, onMounted, watch } from 'vue'
import type { LspProblemItem, LspStatusServerRow } from '@/types/lsp/lsp-status'
import useFleetRegistry from '@/composables/use-fleet-registry'
import formatUnknownError from '@/utils/format-unknown-error'
import { normalizeFileUri } from '@/utils/monaco-lsp'
import { refreshCatalog, syncLspStatePoll, warmDefaults } from './catalog'
import {
  clearDiagnostics,
  countSeverity,
  deriveHealth,
  deriveIsBusy,
  fileUriToProjectPath,
  selectVisibleRows,
  toStatusRow,
} from './helpers'
import { bindListeners, unbindListeners } from './listeners'
import {
  diagnosticsByUri,
  installMessage,
  prefetchBusy,
  servers,
  warmState,
} from './state'

const useLspStatus = () => {
  const fleet = useFleetRegistry()
  const projectRoot = computed(() => fleet.activeProject.value?.rootPath ?? null)

  const statusRows = computed((): LspStatusServerRow[] =>
    [...servers.value.values()].map(toStatusRow),
  )

  const visibleRows = computed((): LspStatusServerRow[] =>
    selectVisibleRows(statusRows.value),
  )

  const errorCount = computed(() => countSeverity(1))
  const warningCount = computed(() => countSeverity(2))

  const hasServerErrors = computed(() =>
    statusRows.value.some(
      (row) => row.displayState === 'error' || row.displayState === 'crashed',
    ),
  )

  const isBusy = computed(() =>
    deriveIsBusy(prefetchBusy.value, servers.value.values()),
  )

  const health = computed(() =>
    deriveHealth(
      isBusy.value,
      statusRows.value,
      errorCount.value,
      warningCount.value,
    ),
  )

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
    }
    if (!root) {
      servers.value = new Map()
      syncLspStatePoll()
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
        installMessage.value = formatUnknownError(error)
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
      installMessage.value = formatUnknownError(error)
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
    clearDiagnostics,
    bindListeners: () => bindListeners(projectRoot),
    unbindListeners,
    fileUriToProjectPath,
  }
}

export default useLspStatus
