import {
  createAgentShell,
  getAgentShell,
  killAgentShell,
  tailShellOutput,
  waitForShellExit,
} from '@/services/harness/shell/registry'
import formatShellExitReason from '@/services/harness/shell/format-exit-reason'
import {
  detectSandboxRuntimeDenial,
  isSandboxDeviceRuntimeDenial,
  isSandboxFilesystemRuntimeDenial,
  isSandboxNetworkRuntimeDenial,
  sandboxRuntimeDenialError,
} from '@/services/harness/shell/sandbox-denial'
import {
  attachSandboxResult,
  resolveSandboxResultMeta,
  wrapWithSandboxingFooter,
} from '@/services/harness/shell/sandbox-result'
import { hasSubagent } from '@/services/harness/subagent/registry'
import type { HarnessToolContext } from '@/types/harness/tool-context'

export const runTerminalCommand = async (
  ctx: HarnessToolContext,
  args: {
    command: string
    is_background?: boolean
    timeout_ms?: number
    description?: string
    sandboxed?: boolean
    allowNetwork?: boolean
  },
): Promise<Record<string, unknown>> => {
  if (ctx.signal?.aborted) {
    throw new Error('Command aborted')
  }

  const meta = resolveSandboxResultMeta({
    sandboxed: args.sandboxed,
    allowNetwork: args.allowNetwork,
  })

  try {
    const shell = await createAgentShell({
      chatId: ctx.chatId,
      projectRoot: ctx.projectRoot,
      command: args.command,
      sandboxed: args.sandboxed,
      allowNetwork: args.allowNetwork,
    })

    if (args.is_background) {
      return attachSandboxResult(
        {
          shellId: shell.shellId,
          status: 'running',
          command: args.command,
          description: args.description ?? null,
        },
        meta,
      )
    }

    const timeoutMs = args.timeout_ms
    const waitResult = await waitForShellExit(shell.shellId, timeoutMs)
    const current = getAgentShell(shell.shellId)
    const stdout = current?.stdout ?? ''
    const stderr = current?.stderr ?? ''
    const combined = `${stdout}\n${stderr}`
    const denial = meta.sandboxed
      ? detectSandboxRuntimeDenial(combined, {
          command: args.command,
          projectRoot: ctx.projectRoot,
          sandboxed: true,
          allowNetwork: args.allowNetwork,
        })
      : null

    if (waitResult.timedOut) {
      await killAgentShell(shell.shellId)
      throw new Error(`Command timed out after ${timeoutMs}ms: ${args.command}`)
    }

    if (waitResult.exitCode !== 0) {
      const reason = formatShellExitReason(waitResult)
      const detail = stderr.trim() || stdout.trim() || reason
      if (denial) {
        throw sandboxRuntimeDenialError(denial, detail)
      }
      throw new Error(`Command failed (${reason}): ${detail}`)
    }

    // Empty device probes, silent curl, and empty out-of-workspace find can exit 0.
    if (
      isSandboxDeviceRuntimeDenial(denial) ||
      isSandboxNetworkRuntimeDenial(denial) ||
      isSandboxFilesystemRuntimeDenial(denial)
    ) {
      const detail = stderr.trim() || stdout.trim() || args.command
      throw sandboxRuntimeDenialError(denial, detail)
    }

    return attachSandboxResult(
      {
        shellId: shell.shellId,
        command: args.command,
        stdout,
        stderr,
        exitCode: waitResult.exitCode,
        timedOut: false,
        description: args.description ?? null,
      },
      meta,
    )
  } catch (error) {
    throw wrapWithSandboxingFooter(error, meta)
  }
}

export const readTerminalOutput = async (
  shellId: string,
  block?: boolean,
  tail?: number,
): Promise<Record<string, unknown>> => {
  if (hasSubagent(shellId)) {
    throw new Error(
      'That id is a subagent, not a shell. Do not poll subagents with terminal_output. End your turn; the harness resumes when background subagents finish.',
    )
  }

  const shell = getAgentShell(shellId)
  if (!shell) {
    throw new Error(`Shell not found: ${shellId}`)
  }

  if (block && shell.status === 'running') {
    await waitForShellExit(shellId)
  }

  const current = getAgentShell(shellId)
  if (!current) {
    throw new Error(`Shell not found: ${shellId}`)
  }

  const output = tailShellOutput(current, tail)

  return {
    shellId,
    status: current.status,
    stdout: output.stdout,
    stderr: output.stderr,
    exitCode: current.exitCode,
  }
}
