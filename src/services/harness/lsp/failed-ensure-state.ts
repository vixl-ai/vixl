import { isTransientPhase } from '@/composables/lsp-status/helpers'
import type { LspPhase, LspServerState } from '@/services/vixl/vixl-tauri'

export const failedEnsureState = (error: unknown): LspServerState => ({
  id: '',
  phase: 'error',
  generation: 0,
  revision: 0,
  phaseSinceMs: 0,
  message: null,
  error: error instanceof Error ? error.message : 'LSP ensure failed',
  activity: null,
  source: null,
  workspaceRoot: null,
  pid: null,
  running: false,
})

const transientEnsureError = (phase: LspPhase): string =>
  phase === 'starting' ? 'still starting' : phase

export const blockedEnsureResponse = (
  server: LspServerState,
): { error: string; installState: LspPhase } | null => {
  if (server.running) {
    return null
  }
  if (isTransientPhase(server.phase)) {
    return {
      error: transientEnsureError(server.phase),
      installState: server.phase,
    }
  }
  return {
    error: server.error ?? 'LSP unavailable',
    installState: server.phase,
  }
}
