import { toast } from 'vue-sonner'
import type { TerminalPayload } from '@/types/workbench/workbench-tab'
import { shellKillPty, shellWritePty } from '@/services/vixl/vixl-tauri'
import { focusTab, updateTab } from './helpers'
import {
  activeTabId,
  tabs,
  tabRefreshTokens,
  terminalSessions,
} from './state'

export const closeTab = async (id: string): Promise<void> => {
  const tab = tabs.value.find((item) => item.id === id)
  if (!tab) {
    return
  }

  if (tab.type === 'terminal') {
    const sessionId = terminalSessions.get(id)
    if (sessionId) {
      try {
        await shellKillPty(sessionId)
      } catch (error) {
        toast.error('Failed to close terminal', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
      terminalSessions.delete(id)
    }
  }

  const index = tabs.value.findIndex((item) => item.id === id)
  if (index < 0) {
    return
  }
  tabs.value.splice(index, 1)

  if (activeTabId.value === id) {
    const next = tabs.value[index] ?? tabs.value[index - 1] ?? null
    activeTabId.value = next?.id ?? null
  }
}

export const closeOthers = async (id: string): Promise<void> => {
  const toClose = tabs.value.filter((tab) => tab.id !== id).map((tab) => tab.id)
  for (const tabId of toClose) {
    await closeTab(tabId)
  }
  focusTab(id)
}

export const closeAll = async (): Promise<void> => {
  const toClose = tabs.value.map((tab) => tab.id)
  for (const tabId of toClose) {
    await closeTab(tabId)
  }
}

export const reorderTabs = (fromIndex: number, toIndex: number): void => {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
    return
  }
  const next = [...tabs.value]
  const [moved] = next.splice(fromIndex, 1)
  if (!moved) {
    return
  }
  next.splice(toIndex, 0, moved)
  tabs.value = next
}

export const registerTerminalSession = (tabId: string, sessionId: string): void => {
  terminalSessions.set(tabId, sessionId)
  const tab = tabs.value.find((item) => item.id === tabId)
  if (tab?.type === 'terminal') {
    updateTab(tabId, {
      payload: { sessionId } satisfies TerminalPayload,
    })
  }
}

export const unregisterTerminalSession = (tabId: string): void => {
  terminalSessions.delete(tabId)
}

export const getActiveTerminalSessionId = (): string | null => {
  const active = tabs.value.find((tab) => tab.id === activeTabId.value)
  if (!active || active.type !== 'terminal') {
    return null
  }
  return terminalSessions.get(active.id) ?? null
}

export const writeToActiveTerminal = async (data: string): Promise<boolean> => {
  const sessionId = getActiveTerminalSessionId()
  if (!sessionId) {
    return false
  }
  await shellWritePty(sessionId, data)
  return true
}

export const refreshPlanStudioTabs = (): void => {
  for (const tab of tabs.value) {
    if (tab.type === 'plan' || tab.type === 'studio') {
      tabRefreshTokens.value[tab.id] = (tabRefreshTokens.value[tab.id] ?? 0) + 1
    }
  }
}
