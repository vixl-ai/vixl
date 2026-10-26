import type { AgentShellRecord } from '@/types/harness/agent-shell'
import type { ShellExitResult } from '@/types/harness/shell-exit'

export default (
  shell: AgentShellRecord | undefined,
  shellId: string,
  timeoutMs: number | undefined,
  exitWaiters: Map<string, Array<(exit: ShellExitResult) => void>>,
): Promise<ShellExitResult & { timedOut: boolean }> => {
  if (!shell) {
    return Promise.reject(new Error(`Shell not found: ${shellId}`))
  }

  const toExitResult = (): ShellExitResult => ({
    exitCode: shell.exitCode ?? -1,
    signal: shell.exitSignal ?? undefined,
  })

  if (shell.status !== 'running') {
    return Promise.resolve({
      ...toExitResult(),
      timedOut: false,
    })
  }

  return new Promise((resolve) => {
    const hasTimeout =
      typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    const timer = hasTimeout
      ? setTimeout(() => {
          resolve({
            ...toExitResult(),
            timedOut: true,
          })
        }, timeoutMs)
      : null

    const onExit = (exit: ShellExitResult): void => {
      if (timer) {
        clearTimeout(timer)
      }
      resolve({ ...exit, timedOut: false })
    }

    const waiters = exitWaiters.get(shellId) ?? []
    waiters.push(onExit)
    exitWaiters.set(shellId, waiters)
  })
}
