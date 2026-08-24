import { ref } from 'vue'
import type { McpConfig } from '@/types/vixl/mcp-config'
import type { McpServerState } from '@/services/vixl/vixl-tauri'

export const personalMcp = ref<McpConfig>({ servers: {} })
export const projectMcp = ref<McpConfig>({ servers: {} })
export const serverStates = ref<Record<string, McpServerState>>({})
export const loadingServers = ref<Record<string, boolean>>({})
export const authenticatingServers = ref<Record<string, boolean>>({})
export const startInFlight = new Map<string, Promise<void>>()
export let refreshGeneration = 0

export const bumpRefreshGeneration = (): number => {
  refreshGeneration += 1
  return refreshGeneration
}
