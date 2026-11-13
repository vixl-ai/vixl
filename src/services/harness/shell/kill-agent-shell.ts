import { shellKillTracked } from '@/services/vixl/vixl-tauri'
import type { AgentShellRecord } from '@/types/harness/agent-shell'
import type { ShellExitResult } from '@/types/harness/shell-exit'

type ExitWaitResult = ShellExitResult & { timedOut: boolean }

export type KillAgentShellDeps = {
  shells: Map<string, AgentShellRecord>
  markShellComplete: (
    shellId: string,
    exit: ShellExitResult,
    options?: { keepListeners?: boolean },
  ) => void
  waitForShellExit: (shellId: string, timeoutMs?: number) => Promise<ExitWaitResult>
  bumpRevision: () => void
}

export type KillAgentShell = {
  killAgentShell: (shellId: string) => Promise<AgentShellRecord>
  resetKillInFlight: () => void
}

// Concurrent kills (e.g. lifecycle stop() and the orchestrator onAbort for
// the same chat) join the same in-flight promise instead of racing a second
// shell_kill_tracked IPC into the "Shell not found" fallback.
export default (deps: KillAgentShellDeps): KillAgentShell => {
  const killInFlight = new Map<string, Promise<AgentShellRecord>>()

  const runKill = async (shellId: string): Promise<AgentShellRecord> => {
    const shell = deps.shells.get(shellId)
    if (!shell) {
      throw new Error(`Shell not found: ${shellId}`)
    }

    if (shell.status === 'running') {
      shell.wakeParent = false
      try {
        const exit = await shellKillTracked(shellId)
        deps.markShellComplete(shellId, exit, { keepListeners: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // Backend may have already reaped the process between our status check and kill.
        if (!message.includes('Shell not found')) {
          throw error
        }
        if (shell.status === 'running') {
          const waitResult = await deps.waitForShellExit(shellId, 5_000)
          deps.markShellComplete(shellId, {
            exitCode: waitResult.exitCode,
            signal: waitResult.signal,
          })
        }
      }
    }

    deps.bumpRevision()
    return shell
  }

  const killAgentShell = (shellId: string): Promise<AgentShellRecord> => {
    const pending = killInFlight.get(shellId)
    if (pending) {
      return pending
    }
    const run = runKill(shellId).finally(() => {
      if (killInFlight.get(shellId) === run) {
        killInFlight.delete(shellId)
      }
    })
    killInFlight.set(shellId, run)
    return run
  }

  return { killAgentShell, resetKillInFlight: () => killInFlight.clear() }
}
