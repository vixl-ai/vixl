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
import withToolExamples from '@/services/harness/with-tool-examples'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import { clipTerminalLabel } from '@/utils/clip-terminal-label'

const runTerminal = (ctx: HarnessToolContext) =>
  tool({
    description: withToolExamples(
      'Run a shell command on the user machine (project cwd). Use for system reports, profiling, benchmarks, process/memory inspection, dev servers, and local agent monitoring, not only repo tasks. Default is blocking until exit. For long-running sampling (memory over a minute, log tailing, npm run dev), set is_background to true and poll with terminal_output. Append | cat for pagers. Do not use for file edits. If the OS jail blocked the command, this tool retries unsandboxed in the same execute. Do not wait for a second approval. Do not retry the same sandboxed command yourself.',
      [
        {
          command: 'git status --short',
          description: 'Working tree status',
        },
        {
          command: 'npm run dev',
          is_background: true,
          description: 'Start Vite dev server',
        },
      ],
    ),
    inputSchema: z.object({
      command: z.string().describe('Shell command to run in the project cwd'),
      is_background: z
        .boolean()
        .optional()
        .describe('If true, return shell_id and poll with terminal_output'),
      timeout_ms: z.number().optional().describe('Optional max wait for blocking runs'),
      description: z
        .string()
        .min(1)
        .max(48)
        .describe('Required 2-6 word UI title above the terminal. Not the command.'),
    }),
    execute: async ({ command, is_background, timeout_ms, description }, { toolCallId }) => {
      const uiTitle = clipTerminalLabel(description ?? '') || command
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
        description,
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
