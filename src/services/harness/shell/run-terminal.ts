import { tool } from 'ai'
import { z } from 'zod'
import { gateToolPermission } from '@/services/harness/permission/gate'
import {
  sessionAllowsNetwork,
  sessionAllowsUnsandboxed,
} from '@/services/harness/permission/policy'
import {
  isSandboxSpawnError,
  parseSandboxRuntimeDenialKind,
} from '@/services/harness/shell/sandbox-denial'
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
      'Run a shell command on the user machine (project cwd). Use for system reports, profiling, benchmarks, process/memory inspection, dev servers, and local agent monitoring, not only repo tasks. Default is blocking until exit. For long-running sampling (memory over a minute, log tailing, npm run dev), set is_background to true and poll with terminal_output. Append | cat for pagers. Do not use for file edits. If the SANDBOXING footer says the jail blocked the command, wait for the user to approve Run outside sandbox; do not retry the same sandboxed command.',
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
      const allowNetwork =
        (ctx.settings['agent.sandbox.network'] ?? 'deny') === 'allow' ||
        sessionAllowsNetwork(ctx.sessionAllows)
      const meta = resolveSandboxResultMeta({
        sandboxed: sandboxEnabled,
        allowNetwork,
      })
      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'run_terminal',
        kind: 'shell',
        action: sandboxEnabled ? 'shell' : 'shell.unsandboxed',
        capability: sandboxEnabled ? 'shell' : 'shell.unsandboxed',
        title: uiTitle,
        unsandboxed: !sandboxEnabled,
      })
      if (!allowed) {
        return attachSandboxResult(
          { rejected: true, error: 'Shell access denied' },
          meta,
        )
      }

      const runArgs = {
        command,
        is_background,
        timeout_ms,
        description,
      }

      const retryUnsandboxed = async (
        message: string,
        priorPhase: Record<string, unknown>,
      ): Promise<Record<string, unknown>> => {
        const unsandboxedAllowed = await gateToolPermission({
          ctx: toPermCtx(ctx),
          toolCallId,
          name: 'run_terminal',
          kind: 'shell',
          action: 'shell.unsandboxed',
          capability: 'shell.unsandboxed',
          title: uiTitle,
          detail: `Sandbox blocked this command. Approve to retry without sandbox.\n\n${message}`,
          unsandboxed: true,
        })

        if (!unsandboxedAllowed) {
          return attachSandboxResult(
            { rejected: true, error: `Sandbox blocked: ${message}` },
            meta,
          )
        }

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
          const denialKind = parseSandboxRuntimeDenialKind(message)
          const shouldOfferNetwork =
            denialKind === 'network' && !allowNetwork

          if (shouldOfferNetwork) {
            const networkAllowed = await gateToolPermission({
              ctx: toPermCtx(ctx),
              toolCallId,
              name: 'run_terminal',
              kind: 'shell',
              action: 'shell.network',
              capability: 'shell.network',
              title: uiTitle,
              detail: `Sandbox blocked this command. Approve to allow network in the sandbox.\n\n${message}`,
              unsandboxed: false,
            })

            if (!networkAllowed) {
              return attachSandboxResult(
                { rejected: true, error: `Sandbox blocked: ${message}` },
                meta,
              )
            }

            const priorPhase = attachSandboxResult(
              {
                command,
                error: message,
              },
              meta,
            )
            const networkMeta = resolveSandboxResultMeta({
              sandboxed: true,
              allowNetwork: true,
            })

            try {
              const result = await runTerminalCommand(ctx, {
                ...runArgs,
                sandboxed: true,
                allowNetwork: true,
              })
              return {
                ...result,
                priorPhase,
              }
            } catch (networkRetryError) {
              const networkRetryMessage =
                networkRetryError instanceof Error
                  ? networkRetryError.message
                  : String(networkRetryError)
              const networkPriorPhase = attachSandboxResult(
                {
                  command,
                  error: networkRetryMessage,
                  priorPhase,
                },
                networkMeta,
              )

              if (isSandboxSpawnError(networkRetryMessage)) {
                return retryUnsandboxed(networkRetryMessage, networkPriorPhase)
              }

              return attachSandboxResult(
                {
                  command,
                  error: networkRetryMessage,
                  priorPhase,
                },
                networkMeta,
              )
            }
          }

          const priorPhase = attachSandboxResult(
            {
              command,
              error: message,
            },
            meta,
          )
          return retryUnsandboxed(message, priorPhase)
        }

        throw wrapWithSandboxingFooter(error, meta)
      }
    },
  })

export default runTerminal
