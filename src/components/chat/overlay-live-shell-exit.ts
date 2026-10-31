import type { AgentShellRecord } from '@/types/harness/agent-shell'
import type { TerminalToolPhaseView } from '@/utils/parse-terminal-tool-view'

export const overlayLiveShellExit = (
  phase: TerminalToolPhaseView,
  shell: Pick<AgentShellRecord, 'status' | 'exitCode'> | null | undefined,
): TerminalToolPhaseView => {
  if (shell?.status !== 'completed' && shell?.status !== 'failed') {
    return phase
  }
  if (typeof shell.exitCode !== 'number') {
    return phase
  }
  return {
    ...phase,
    exitCode: shell.exitCode,
  }
}
