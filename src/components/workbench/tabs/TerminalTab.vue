<script setup lang="ts">
import '@xterm/xterm/css/xterm.css'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { toast } from 'vue-sonner'
import {
  shellKillPty,
  shellResizePty,
  shellSpawnPty,
  shellWritePty,
} from '@/services/vixl/vixl-tauri'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useWorkbenchStore from '@/composables/use-workbench-store'
import observeDocumentTheme from '@/utils/observe-document-theme'
import type { TerminalPayload, WorkbenchTab } from '@/types/workbench/workbench-tab'

const TERMINAL_FONT_FAMILY = "'JetBrains Mono', 'SF Mono', ui-monospace, monospace"
const TERMINAL_FONT_SIZE = 13

const props = defineProps<{
  tab: WorkbenchTab
}>()

const fleet = useFleetRegistry()
const workbench = useWorkbenchStore()
const containerRef = ref<HTMLDivElement | null>(null)

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let sessionId: string | null = null
let unlisten: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let pendingSizeObserver: ResizeObserver | null = null
let stopThemeObserver: (() => void) | null = null
let ptyErrorShown = false
let initialized = false
let initFailed = false

const readCssVariable = (name: string): string => {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

const buildTerminalTheme = (): ITheme => {
  const background = readCssVariable('--background')
  const foreground = readCssVariable('--foreground')
  const accent = readCssVariable('--accent')
  const accentForeground = readCssVariable('--accent-foreground')

  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: accent,
    selectionForeground: accentForeground,
    selectionInactiveBackground: readCssVariable('--muted'),
  }
}

const applyDocumentTheme = (): void => {
  if (terminal) {
    terminal.options.theme = buildTerminalTheme()
  }
}

const notifyPtyError = (title: string, error: unknown): void => {
  if (ptyErrorShown) {
    return
  }
  ptyErrorShown = true
  toast.error(title, {
    description: error instanceof Error ? error.message : 'Unknown error',
  })
}

const resolveProjectRoot = (): string | null => {
  return workbench.getProject(props.tab.projectId)?.rootPath ?? null
}

const hasContainerSize = (element: HTMLDivElement): boolean => {
  return element.clientWidth > 0 && element.clientHeight > 0
}

const cleanupPendingSizeObserver = (): void => {
  pendingSizeObserver?.disconnect()
  pendingSizeObserver = null
}

const reportInitFailure = (error: unknown): void => {
  if (initFailed) {
    return
  }
  initFailed = true
  cleanupPendingSizeObserver()
  toast.error('Failed to start terminal', {
    description: error instanceof Error ? error.message : 'Unknown error',
  })
}

const initTerminal = async (): Promise<void> => {
  if (initialized || terminal || initFailed) {
    return
  }

  const container = containerRef.value
  if (!container) {
    return
  }

  const root = resolveProjectRoot()
  if (!root) {
    if (fleet.loaded.value) {
      throw new Error('Project root path is unavailable')
    }
    return
  }

  if (!hasContainerSize(container)) {
    return
  }

  try {
    terminal = new Terminal({
      cursorBlink: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: TERMINAL_FONT_SIZE,
      theme: buildTerminalTheme(),
    })
    fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    fitAddon.fit()

    const payload = props.tab.payload as TerminalPayload
    const { sessionId: id } = await shellSpawnPty({
      projectRoot: root,
      cols: terminal.cols,
      rows: terminal.rows,
      cwd: payload.cwd ?? undefined,
    })
    sessionId = id
    workbench.registerTerminalSession(props.tab.id, id)

    unlisten = await listen<string>(`pty-output-${id}`, (event) => {
      terminal?.write(event.payload)
    })

    terminal.onData((data) => {
      if (sessionId) {
        shellWritePty(sessionId, data).catch((error) => {
          notifyPtyError('Terminal input failed', error)
        })
      }
    })

    resizeObserver = new ResizeObserver(() => {
      fitAddon?.fit()
      if (terminal && sessionId) {
        shellResizePty(sessionId, terminal.cols, terminal.rows).catch((error) => {
          notifyPtyError('Terminal resize failed', error)
        })
      }
    })
    resizeObserver.observe(container)

    initialized = true
    cleanupPendingSizeObserver()
  } catch (error) {
    terminal?.dispose()
    terminal = null
    fitAddon = null
    reportInitFailure(error)
    throw error
  }
}

const ensureInitWhenReady = (): void => {
  if (initialized || terminal || initFailed) {
    return
  }

  const container = containerRef.value
  if (!container) {
    return
  }

  if (resolveProjectRoot() && hasContainerSize(container)) {
    initTerminal().catch((error) => {
      reportInitFailure(error)
    })
    return
  }

  if (pendingSizeObserver) {
    return
  }

  pendingSizeObserver = new ResizeObserver(() => {
    if (!containerRef.value || !hasContainerSize(containerRef.value)) {
      return
    }
    initTerminal().catch((error) => {
      reportInitFailure(error)
    })
  })
  pendingSizeObserver.observe(container)
}

onMounted(async () => {
  stopThemeObserver = observeDocumentTheme(applyDocumentTheme)
  await nextTick()
  ensureInitWhenReady()
})

watch(
  () => [fleet.loaded.value, fleet.projects.value, props.tab.projectId] as const,
  () => {
    ensureInitWhenReady()
  },
)

watch(
  () => workbench.activeTabId.value === props.tab.id,
  (isActive) => {
    if (isActive) {
      ensureInitWhenReady()
    }
  },
)

onBeforeUnmount(() => {
  stopThemeObserver?.()
  stopThemeObserver = null
  cleanupPendingSizeObserver()
  workbench.unregisterTerminalSession(props.tab.id)
  if (unlisten) {
    unlisten()
  }
  if (sessionId) {
    shellKillPty(sessionId).catch((error) => {
      notifyPtyError('Failed to close terminal', error)
    })
  }
  resizeObserver?.disconnect()
  terminal?.dispose()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
    <div ref="containerRef" class="min-h-0 flex-1 p-1" />
  </div>
</template>
