import { tool } from 'ai'
import { z } from 'zod'
import resolveAgentDefinition from '@/services/agents/resolve-agent-definition'
import {
  assertNotAwaitingPlanGo,
  getPlanExecutionSession,
} from '@/services/harness/plan-execution-session'
import {
  register as registerSubagent,
  resolve as resolveSubagent,
} from '@/services/harness/subagent/registry'
import {
  emitSubagentResult,
  finishSubagentWithError,
} from '@/services/harness/subagent/helpers'
import resolveSpawnModel from '@/services/harness/subagent/resolve-spawn-model'
import runSubagentGenerate from '@/services/harness/subagent/run-generate'
import { READ_ONLY_SPAWN_MODES } from '@/services/harness/subagent/constants'
import withToolExamples from '@/services/harness/with-tool-examples'
import linkAbortSignal from '@/utils/link-abort-signal'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const spawnSubagent = (ctx: HarnessToolContext) =>
  tool({
    description: withToolExamples(
      "Spawn a subagent. Default mode is blocking (waits until complete). Set mode to background to run concurrently: return immediately, end your turn, and do not poll with terminal_output (subagentId is not a shell_id). The harness resumes this chat with the summary when all background subagents finish. Default capabilities are read-only. Edit, write, modify, delete, move, or shell/git mutations REQUIRE capabilities: 'write'. A read-only subagent can only report; it cannot make changes. In Ask, Plan, and Studio modes, subagents are restricted to read-only; the write capability is rejected. agentName must be a very brief verb phrase that explains the work (for example \"Reading auth\", \"Editing config\").",
      [
        {
          agentName: 'Reading auth',
          prompt: 'Find where MCP trust is granted and summarize the flow.',
          mode: 'blocking',
          model: 'anthropic::claude-sonnet-4',
        },
        {
          agentName: 'Scanning permissions',
          prompt: 'List shell and MCP permission gates.',
          mode: 'background',
        },
        {
          agentName: 'Editing config',
          prompt: 'Update the timeout in the harness settings file.',
          mode: 'blocking',
          capabilities: 'write',
        },
      ],
    ),
    inputSchema: z.object({
      agentName: z
        .string()
        .describe(
          'Very brief UI label. Prefer a verb phrase that explains the work, such as "Reading auth", "Editing config", or "Exploring LSP".',
        ),
      prompt: z.string().describe('Task instructions for the subagent'),
      mode: z
        .enum(['blocking', 'background'])
        .default('blocking')
        .describe(
          'blocking waits inline; background returns running, then end your turn and wait for harness resume',
        ),
      model: z
        .string()
        .optional()
        .describe(
          'Exact provider::modelId from resolve_models (for example anthropic::claude-sonnet-4). Fuzzy names are rejected.',
        ),
      capabilities: z
        .enum(['read-only', 'write'])
        .default('read-only')
        .describe(
          "REQUIRED 'write' for edit/write/modify/delete/move or shell/git mutations. read-only (default) can only report, not change. write grants file edit, apply_patch, delete/move, run_terminal, and git commit/checkout/branch.",
        ),
    }),
    execute: async (
      { agentName, prompt, mode, model: callModel, capabilities },
      { toolCallId },
    ): Promise<
      | { subagentId: string; name: string; summary: string }
      | {
          subagentId: string
          status: 'running'
          note: string
        }
    > => {
      assertNotAwaitingPlanGo(ctx.projectSlug, ctx.chatId)

      if (ctx.signal?.aborted) {
        throw new Error('Subagent aborted')
      }

      const resolvedCapabilities = capabilities ?? 'read-only'
      if (
        READ_ONLY_SPAWN_MODES.has(ctx.mode) &&
        resolvedCapabilities === 'write'
      ) {
        throw new Error(
          `Write-capable subagents are not allowed in ${ctx.mode} mode. Spawn with capabilities: "read-only" (the default).`,
        )
      }

      const subagentId = crypto.randomUUID()
      const lockedSubagentModel = getPlanExecutionSession(
        ctx.projectSlug,
        ctx.chatId,
      ).subagentModel
      const agentDefinition = await resolveAgentDefinition(
        ctx.projectRoot,
        agentName,
      ).catch(() => null)
      const model = await resolveSpawnModel({
        callModel,
        lockedModel: lockedSubagentModel,
        frontmatterModel: agentDefinition?.model,
        settings: ctx.settings,
      })
      const blocking = mode === 'blocking'
      const controller = new AbortController()
      linkAbortSignal(ctx.signal, controller)

      registerSubagent(
        ctx.chatId,
        subagentId,
        controller,
        {
          toolCallId,
          agentName,
        },
        {
          pendingResume: !blocking,
        },
      )

      ctx.onHarnessEvent?.({
        type: 'subagent-start',
        subagentId,
        toolCallId,
        name: agentName,
        blocking,
        prompt,
        model,
        capabilities: resolvedCapabilities,
      })

      if (!blocking) {
        ctx.onHarnessEvent?.({
          type: 'pending-subagent',
          toolCallId,
          subagentId,
          agentName,
          prompt,
        })

        const completeSubagent = async (): Promise<void> => {
          try {
            const summary = await runSubagentGenerate({
              ctx,
              subagentId,
              agentName,
              prompt,
              toolCallId,
              signal: controller.signal,
              model,
              capabilities: resolvedCapabilities,
            })

            resolveSubagent(subagentId, { subagentId, name: agentName, summary })
            emitSubagentResult(ctx, {
              subagentId,
              summary,
              blocking: false,
              outcome: 'completed',
            })
          } catch (error) {
            finishSubagentWithError(ctx, {
              subagentId,
              error,
              blocking: false,
            })
          }
        }

        completeSubagent().catch((error) => {
          finishSubagentWithError(ctx, {
            subagentId,
            error,
            blocking: false,
          })
        })

        return {
          subagentId,
          status: 'running',
          note: 'Do not poll with terminal_output. End your turn; the harness resumes when background subagents finish. subagentId is not a shell_id.',
        }
      }

      try {
        const summary = await runSubagentGenerate({
          ctx,
          subagentId,
          agentName,
          prompt,
          toolCallId,
          signal: controller.signal,
          model,
          capabilities: resolvedCapabilities,
        })

        resolveSubagent(subagentId, { subagentId, name: agentName, summary })
        emitSubagentResult(ctx, {
          subagentId,
          summary,
          blocking: true,
          outcome: 'completed',
        })

        return { subagentId, name: agentName, summary }
      } catch (error) {
        finishSubagentWithError(ctx, {
          subagentId,
          error,
          blocking: true,
        })
        throw error
      }
    },
  })

export default spawnSubagent
