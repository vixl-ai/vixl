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
import {
  cwdSlugFields,
  isMultiRootWorkspace,
  resolveWorkspaceSlug,
  slugArg,
} from '@/services/harness/tool-roots'
import { clipTerminalLabel } from '@/utils/clip-terminal-label'
import { isSshProjectRoot, sshRunsAsLineFromRoot } from '@/utils/ssh-project-root'
import {
  commandLooksLikeSsh,
  commandLooksLikeSudo,
} from '@/services/harness/ssh/command'
import { sshRunTerminalGuard } from '@/services/harness/ssh/run-terminal-guards'
import {
  SSH_SANDBOX_RETRY_BLOCKED,
  sshHostFromRoot,
  sudoNoTtyError,
} from '@/services/harness/ssh/model-errors'

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

const CWD_TOOL_HINT =
  'Optional cwd is a project slug; defaults to the primary project and is not kept between calls.'

const SANDBOX_RETRY_HINT =
  ' A sandbox block retries unsandboxed automatically within the same call.'

const runTerminal = (ctx: HarnessToolContext) => {
  const readOnlyProject = isReadOnlySubagentShell(ctx)
  const multiRoot = isMultiRootWorkspace(ctx)
  const sandboxRetryHint = isSshProjectRoot(ctx.projectRoot) ? '' : SANDBOX_RETRY_HINT
  return tool({
    description: readOnlyProject
      ? multiRoot
        ? 'Run a shell command in the project cwd, sandboxed with the project read-only; TMPDIR and tool caches stay writable. Optional cwd is a project slug; defaults to the primary project and is not kept between calls. When the sandbox blocks a command, report the denial as the result.'
        : 'Run a shell command in the project cwd, sandboxed with the project read-only; TMPDIR and tool caches stay writable. When the sandbox blocks a command, report the denial as the result.'
      : multiRoot
        ? `Run a shell command in the project cwd. ${CWD_TOOL_HINT}${sandboxRetryHint} is_background returns a shell id and the harness wakes the parent when that terminal exits, so end the turn instead of polling. terminal_output reads output before exit. Scratch dirs and TMPDIR, TEMP, TMP stay outside the repo and .gitignore stays as is; when the sandbox still blocks a command, report the denial.`
        : `Run a shell command in the project cwd.${sandboxRetryHint} is_background returns a shell id and the harness wakes the parent when that terminal exits, so end the turn instead of polling. terminal_output reads output before exit. Scratch dirs and TMPDIR, TEMP, TMP stay outside the repo and .gitignore stays as is; when the sandbox still blocks a command, report the denial.`,
    inputSchema: z.object({
      description: z
        .string()
        .min(1)
        .describe('2-6 word UI title'),
      command: z.string().describe('Shell command'),
      is_background: z.boolean().optional().describe('Return shell_id without waiting'),
      timeout_ms: z.number().optional().describe('Optional max wait for blocking runs'),
      ...cwdSlugFields(ctx),
    }),
    execute: async (input, { toolCallId }) => {
      const { command, is_background, timeout_ms, description } = input
      const resolvedCwd = resolveWorkspaceSlug(ctx, slugArg(input, 'cwd'))
      const clippedDescription = clipTerminalLabel(description ?? '')
      const uiTitle = clippedDescription || command
      const remoteRoot = isSshProjectRoot(resolvedCwd.projectRoot)
      const sandboxSettingEnabled = ctx.settings['agent.sandbox.enabled'] ?? true
      if (remoteRoot) {
        const guarded = sshRunTerminalGuard(
          resolvedCwd.projectRoot,
          command,
          readOnlyProject,
          resolvedCwd.slug,
        )
        if (guarded) {
          return guarded
        }
      }
      if (readOnlyProject && !sandboxSettingEnabled) {
        return attachSandboxResult(
          { rejected: true, error: READ_ONLY_SANDBOX_DISABLED },
          resolveSandboxResultMeta({
            sandboxed: false,
            allowNetwork: false,
            cwd: resolvedCwd.projectRoot,
            cwdSlug: resolvedCwd.slug,
          }),
        )
      }
      // Read-only nested shells stay jailed: session unsandboxed allowances do not apply.
      const sandboxEnabled = remoteRoot
        ? false
        : readOnlyProject
          ? true
          : sandboxSettingEnabled && !sessionAllowsUnsandboxed(ctx.sessionAllows)
      const needsNetwork =
        sandboxEnabled && commandNeedsSandboxNetwork(command)
      const settingsAllowNetwork =
        (ctx.settings['agent.sandbox.network'] ?? SANDBOX_NETWORK_DEFAULT) ===
          'allow' || sessionAllowsNetwork(ctx.sessionAllows)
      const firstCapability = remoteRoot
        ? 'shell'
        : needsNetwork
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
        unsandboxed: remoteRoot ? false : !sandboxEnabled,
        runsAt: remoteRoot
          ? (sshRunsAsLineFromRoot(resolvedCwd.projectRoot) ?? undefined)
          : undefined,
      })
      if (!allowed) {
        if (remoteRoot) {
          return {
            rejected: true,
            error: 'Shell access denied',
            remote: true,
            cwd: resolvedCwd.projectRoot,
            ...(resolvedCwd.slug ? { cwdSlug: resolvedCwd.slug } : {}),
            runsAt: sshRunsAsLineFromRoot(resolvedCwd.projectRoot) ?? undefined,
          }
        }
        return attachSandboxResult(
          { rejected: true, error: 'Shell access denied' },
          resolveSandboxResultMeta({
            sandboxed: sandboxEnabled,
            allowNetwork: settingsAllowNetwork,
            cwd: resolvedCwd.projectRoot,
            cwdSlug: resolvedCwd.slug,
          }),
        )
      }

      const allowNetwork =
        remoteRoot ||
        needsNetwork ||
        settingsAllowNetwork ||
        sessionAllowsNetwork(ctx.sessionAllows)
      const meta = resolveSandboxResultMeta({
        sandboxed: sandboxEnabled,
        allowNetwork,
        cwd: resolvedCwd.projectRoot,
        cwdSlug: resolvedCwd.slug,
      })
      const runsAt = sshRunsAsLineFromRoot(resolvedCwd.projectRoot)

      const runArgs = {
        command,
        is_background,
        timeout_ms,
        description: clippedDescription || undefined,
        projectWritable: !readOnlyProject,
        projectRoot: resolvedCwd.projectRoot,
        cwdSlug: resolvedCwd.slug,
        toolCallId,
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
            resolveSandboxResultMeta({
              sandboxed: false,
              allowNetwork: true,
              cwd: resolvedCwd.projectRoot,
              cwdSlug: resolvedCwd.slug,
            }),
          )
        }
      }

      const blockUnsandboxedRetry =
        remoteRoot || commandLooksLikeSsh(command)

      try {
        const result = await runTerminalCommand(ctx, {
          ...runArgs,
          sandboxed: sandboxEnabled,
          allowNetwork,
        })
        if (remoteRoot) {
          const { sandboxed: _sandboxed, sandboxing: _sandboxing, network: _network, ...rest } =
            result
          return {
            ...rest,
            remote: true,
            ...(runsAt ? { runsAt } : {}),
          }
        }
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        if (remoteRoot && commandLooksLikeSudo(command)) {
          throw new Error(sudoNoTtyError(sshHostFromRoot(resolvedCwd.projectRoot)))
        }
        if (remoteRoot && commandLooksLikeSsh(command) && /no tty|no terminal/i.test(message)) {
          throw new Error(sudoNoTtyError(sshHostFromRoot(resolvedCwd.projectRoot)))
        }

        if (readOnlyProject) {
          if (message.startsWith('SANDBOX_UNAVAILABLE:')) {
            return attachSandboxResult(
              { rejected: true, error: READ_ONLY_SANDBOX_UNAVAILABLE },
              meta,
            )
          }
          throw wrapWithSandboxingFooter(error, meta)
        }

        if (sandboxEnabled && isSandboxSpawnError(message) && blockUnsandboxedRetry) {
          return attachSandboxResult(
            {
              command,
              error: SSH_SANDBOX_RETRY_BLOCKED,
            },
            meta,
          )
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

        if (remoteRoot) {
          throw error instanceof Error ? error : new Error(message)
        }

        throw wrapWithSandboxingFooter(error, meta)
      }
    },
  })
}

export default runTerminal
