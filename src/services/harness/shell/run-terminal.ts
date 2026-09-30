import { tool } from 'ai'
import { z } from 'zod'
import { SANDBOX_NETWORK_DEFAULT } from '@/schemas/vixl-settings'
import { gateToolPermission } from '@/services/harness/permission/gate'
import {
  sessionAllowsNetwork,
  sessionAllowsUnsandboxed,
} from '@/services/harness/permission/policy'
import commandNeedsSandboxNetwork from '@/services/harness/shell/command-needs-network'
import { isSandboxSpawnError } from '@/services/harness/shell/sandbox-denial'
import {
  attachSandboxResult,
  resolveSandboxResultMeta,
  wrapWithSandboxingFooter,
} from '@/services/harness/shell/sandbox-result'
import { runTerminalCommand } from '@/services/harness/shell/run-command'
import { getSubagent } from '@/services/harness/subagent/registry'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import { clipTerminalLabel } from '@/utils/clip-terminal-label'

const READ_ONLY_SANDBOX_DISABLED =
  'Read-only subagents cannot run an unsandboxed shell. Enable the OS sandbox, or spawn a write-capable subagent.'
const READ_ONLY_SANDBOX_UNAVAILABLE =
  'Read-only subagents require an OS sandbox. This platform has no sandbox, so run_terminal is unavailable.'

export const isReadOnlySubagentShell = (ctx: HarnessToolContext): boolean => {
  if (!ctx.subagentId) {
    return false
  }
  if (ctx.subagentCapabilities === 'write') {
    return false
  }
  if (ctx.subagentCapabilities === 'read-only') {
    return true
  }
  const record = getSubagent(ctx.subagentId)
  if (!record) {
    return false
  }
  return (record.capabilities ?? 'read-only') !== 'write'
}

const runTerminal = (ctx: HarnessToolContext) => {
  const readOnlyProject = isReadOnlySubagentShell(ctx)
  return tool({
    description: readOnlyProject
      ? 'Run a shell command in the project cwd, sandboxed with the project read-only; TMPDIR and tool caches stay writable. When the sandbox blocks a command, report the denial as the result.'
      : 'Run a shell command in the project cwd. A sandbox block retries unsandboxed automatically within the same call. is_background returns a shell_id for terminal_output. Scratch dirs and TMPDIR, TEMP, TMP stay outside the repo and .gitignore stays as is; when the sandbox still blocks a command, report the denial.',
    inputSchema: z.object({
      command: z.string().describe('Shell command'),
      is_background: z.boolean().optional().describe('Return shell_id without waiting'),
      timeout_ms: z.number().optional().describe('Optional max wait for blocking runs'),
      description: z
        .string()
        .min(1)
        .describe('2-6 word UI title'),
    }),
    execute: async ({ command, is_background, timeout_ms, description }, { toolCallId }) => {
      const clippedDescription = clipTerminalLabel(description ?? '')
      const uiTitle = clippedDescription || command
      const sandboxSettingEnabled = ctx.settings['agent.sandbox.enabled'] ?? true
      if (readOnlyProject && !sandboxSettingEnabled) {
        return attachSandboxResult(
          { rejected: true, error: READ_ONLY_SANDBOX_DISABLED },
          resolveSandboxResultMeta({
            sandboxed: false,
            allowNetwork: false,
          }),
        )
      }
      // Read-only nested shells stay jailed: session unsandboxed allowances do not apply.
      const sandboxEnabled = readOnlyProject
        ? true
        : sandboxSettingEnabled && !sessionAllowsUnsandboxed(ctx.sessionAllows)
      const needsNetwork =
        sandboxEnabled && commandNeedsSandboxNetwork(command)
      const settingsAllowNetwork =
        (ctx.settings['agent.sandbox.network'] ?? SANDBOX_NETWORK_DEFAULT) ===
          'allow' || sessionAllowsNetwork(ctx.sessionAllows)
      const firstCapability = needsNetwork
        ? 'shell.network'
        : sandboxEnabled
          ? 'shell'
          : 'shell.unsandboxed'
      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'run_terminal',
        kind: 'shell',
        action: firstCapability,
        capability: firstCapability,
        title: uiTitle,
        detail: command,
        unsandboxed: !sandboxEnabled,
      })
      if (!allowed) {
        return attachSandboxResult(
          { rejected: true, error: 'Shell access denied' },
          resolveSandboxResultMeta({
            sandboxed: sandboxEnabled,
            allowNetwork: settingsAllowNetwork,
          }),
        )
      }

      const allowNetwork =
        needsNetwork ||
        settingsAllowNetwork ||
        sessionAllowsNetwork(ctx.sessionAllows)
      const meta = resolveSandboxResultMeta({
        sandboxed: sandboxEnabled,
        allowNetwork,
      })

      const runArgs = {
        command,
        is_background,
        timeout_ms,
        description: clippedDescription || undefined,
        projectWritable: !readOnlyProject,
      }

      const retryUnsandboxed = async (
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
              command,
              error: retryMessage,
              priorPhase,
            },
            resolveSandboxResultMeta({ sandboxed: false, allowNetwork: true }),
          )
        }
      }

      try {
        return await runTerminalCommand(ctx, {
          ...runArgs,
          sandboxed: sandboxEnabled,
          allowNetwork,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        if (readOnlyProject) {
          if (message.startsWith('SANDBOX_UNAVAILABLE:')) {
            return attachSandboxResult(
              { rejected: true, error: READ_ONLY_SANDBOX_UNAVAILABLE },
              meta,
            )
          }
          throw wrapWithSandboxingFooter(error, meta)
        }

        if (sandboxEnabled && isSandboxSpawnError(message)) {
          const priorPhase = attachSandboxResult(
            {
              command,
              error: message,
            },
            meta,
          )
          return retryUnsandboxed(priorPhase)
        }

        throw wrapWithSandboxingFooter(error, meta)
      }
    },
  })
}

export default runTerminal
