import { toast } from 'vue-sonner'
import { useDebounceFn } from '@vueuse/core'
import { watch } from 'vue'
import type {
  TerminalPayload,
  WorkbenchTab,
} from '@/types/workbench/workbench-tab'
import type {
  WorkbenchSession,
  WorkbenchSessionTab,
} from '@/types/workbench/workbench-session'
import useFleetRegistry from '@/composables/use-fleet-registry'
import {
  isTauri,
  workbenchLoadSession,
  workbenchReplaceSession,
} from '@/services/vixl/vixl-tauri'
import { ensureHomeRoot, getProject } from './helpers'
import { activeTabId, rightSidebarOpen, tabs } from './state'
import { isHomeChatSlug } from '@/constants/home-chat'

const PERSIST_DEBOUNCE_MS = 400

const toSessionTab = (tab: WorkbenchTab): WorkbenchSessionTab => {
  if (tab.type === 'terminal') {
    const payload = tab.payload as TerminalPayload
    return {
      id: tab.id,
      type: tab.type,
      projectId: tab.projectId,
      label: tab.label,
      payload: {
        sessionId: null,
        ...(payload.cwd ? { cwd: payload.cwd } : {}),
      },
    }
  }
  return {
    id: tab.id,
    type: tab.type,
    projectId: tab.projectId,
    label: tab.label,
    payload: tab.payload,
  }
}

export const toPersistedSession = (
  currentTabs: WorkbenchTab[],
  currentActiveTabId: string | null,
  currentRightSidebarOpen: boolean,
): {
  tabs: WorkbenchSessionTab[]
  activeTabId: string | null
  rightSidebarOpen: boolean
} => ({
  tabs: currentTabs.map(toSessionTab),
  activeTabId: currentActiveTabId,
  rightSidebarOpen: currentRightSidebarOpen,
})

const applySession = async (session: WorkbenchSession): Promise<void> => {
  const restored: WorkbenchTab[] = []
  for (const tab of session.tabs) {
    if (isHomeChatSlug(tab.projectId)) {
      await ensureHomeRoot()
    } else if (!getProject(tab.projectId)) {
      continue
    }
    restored.push({
      id: tab.id,
      type: tab.type,
      projectId: tab.projectId,
      label: tab.label,
      payload: tab.payload,
    })
  }
  tabs.value = restored
  const restoredIds = new Set(restored.map((tab) => tab.id))
  activeTabId.value =
    session.activeTabId && restoredIds.has(session.activeTabId)
      ? session.activeTabId
      : (restored[0]?.id ?? null)
  if (restored.length > 0 || session.rightSidebarOpen === true) {
    rightSidebarOpen.value = true
  } else if (session.rightSidebarOpen === false) {
    rightSidebarOpen.value = false
  }
}

let persistStarted = false
let hydrating = false
let hydrated = false

export const startWorkbenchPersist = (): void => {
  if (persistStarted) {
    return
  }
  persistStarted = true

  const persistNow = async (): Promise<void> => {
    if (!isTauri() || hydrating || !hydrated) {
      return
    }
    try {
      await workbenchReplaceSession(
        toPersistedSession(tabs.value, activeTabId.value, rightSidebarOpen.value),
      )
    } catch (error) {
      toast.error('Failed to save workbench', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const persistDebounced = useDebounceFn(persistNow, PERSIST_DEBOUNCE_MS)

  watch(
    [tabs, activeTabId, rightSidebarOpen],
    () => {
      persistDebounced().catch((error: unknown) => {
        toast.error('Failed to save workbench', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    },
    { deep: true },
  )

  const fleet = useFleetRegistry()
  watch(
    () => fleet.loaded.value,
    async (loaded) => {
      if (!loaded || hydrated || hydrating) {
        return
      }
      if (!isTauri()) {
        hydrated = true
        return
      }
      hydrating = true
      try {
        const session = await workbenchLoadSession()
        await applySession(session)
      } catch (error) {
        tabs.value = []
        activeTabId.value = null
        toast.error('Failed to restore workbench', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      } finally {
        hydrating = false
        hydrated = true
      }
    },
    { immediate: true },
  )
}
