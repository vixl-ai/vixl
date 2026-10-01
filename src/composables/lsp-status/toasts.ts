import { toast } from 'vue-sonner'
import type { LspPhase, LspServerState } from '@/services/vixl/vixl-tauri'
import { toastedFailureKeys } from './state'

const FAILURE_PHASES: ReadonlySet<LspPhase> = new Set(['error', 'crashed'])

export const noteServerState = (state: LspServerState, label: string): void => {
  if (state.revision === 0 || !FAILURE_PHASES.has(state.phase)) {
    return
  }
  const key = `${state.id}:${state.generation}:${state.phase}`
  if (toastedFailureKeys.has(key)) {
    return
  }
  toastedFailureKeys.add(key)
  if (state.error) {
    toast.error(label, { description: state.error })
    return
  }
  toast.error(label)
}
