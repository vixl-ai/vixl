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
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import { clipTerminalLabel } from '@/utils/clip-terminal-label'

const runTerminal = (ctx: HarnessToolContext) =>
  tool({
    description:
      'Run a shell command in the project cwd. If the sandbox blocks the command it retries unsandboxed in the same execute; do not retry yourself. is_background returns shell_id; poll with terminal_output. Do not create project scratch dirs (for example .tmp), redirect TMPDIR, TEMP, or TMP into the repo, or edit .gitignore; if the jail blocks the command, report the denial.',
    inputSchema: z.object({
      command: z.string().describe('Shell command to run in the project cwd'),
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
      const sandboxEnabled =
        (ctx.settings['agent.sandbox.enabled'] ?? true) &&
        !sessionAllowsUnsandboxed(ctx.sessionAllows)
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

export default runTerminal
