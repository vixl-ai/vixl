import type { LspServerState } from '@/services/vixl/vixl-tauri'
import { servers } from './state'

export const applyServerState = (state: LspServerState): boolean => {
  const current = servers.value.get(state.id)
  if (!current || state.revision <= current.state.revision) {
    return false
  }
  const next = new Map(servers.value)
  next.set(state.id, { ...current, state })
  servers.value = next
  return true
}
