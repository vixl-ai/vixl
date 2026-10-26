import { listShellsForChat } from '@/services/harness/shell/registry'
import type { ShellWakeResult } from '@/types/harness/agent-shell'

export const shellResultKey = (result: ShellWakeResult): string =>
  `${result.toolCallId}:shell:${result.exitCode}:${result.signal ?? ''}`

export const runningParentBackgroundShells = (
  chatId: string,
): Array<{ shellId: string; description?: string; command: string }> =>
  listShellsForChat(chatId)
    .filter(
      (shell) =>
        shell.status === 'running' && shell.background === true && !shell.subagentId,
    )
    .map((shell) => ({
      shellId: shell.shellId,
      ...(shell.description ? { description: shell.description } : {}),
      command: shell.command,
    }))
