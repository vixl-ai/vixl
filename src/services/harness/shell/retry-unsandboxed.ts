import { runTerminalCommand } from '@/services/harness/shell/run-command'
import {
  attachSandboxResult,
  resolveSandboxResultMeta,
} from '@/services/harness/shell/sandbox-result'
import type { HarnessToolContext } from '@/types/harness/tool-context'

// Runs the approved unsandboxed second phase after a sandbox spawn failure or
// runtime block. The caller owns the shell.unsandboxed approval; this helper
// only runs the command and keeps the sandboxed first phase as priorPhase.
const retryUnsandboxed = async (
  ctx: HarnessToolContext,
  runArgs: Parameters<typeof runTerminalCommand>[1],
  priorPhase: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  try {
    const result = await runTerminalCommand(ctx, {
      ...runArgs,
      sandboxed: false,
      allowNetwork: true,
    })
    return {
      ...result,
      priorPhase,
    }
  } catch (retryError) {
    const retryMessage =
      retryError instanceof Error ? retryError.message : String(retryError)
    return attachSandboxResult(
      {
        command: runArgs.command,
        error: retryMessage,
        priorPhase,
      },
      resolveSandboxResultMeta({
        sandboxed: false,
        allowNetwork: true,
        cwd: runArgs.projectRoot,
        cwdSlug: runArgs.cwdSlug,
      }),
    )
  }
}

export default retryUnsandboxed