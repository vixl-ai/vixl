import { tool } from 'ai'
import { z } from 'zod'
import {
  assertNotAwaitingPlanGo,
  getPlanExecutionSession,
} from '@/services/harness/plan-execution-session'
import {
  register as registerSubagent,
  resolve as resolveSubagent,
} from '@/services/harness/subagent/registry'
import { emitSubagentResult, finishSubagentWithError } from '@/services/harness/subagent/helpers'
import resolveSpawnModel from '@/services/harness/subagent/resolve-spawn-model'
import runSubagentGenerate from '@/services/harness/subagent/run-generate'
import validateSpawnAgentName from '@/services/harness/subagent/validate-spawn-agent-name'
import { READ_ONLY_SPAWN_MODES } from '@/services/harness/subagent/constants'
import linkAbortSignal from '@/utils/link-abort-signal'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const spawnSubagent = (ctx: HarnessToolContext) =>
  tool({
    description:
      'Spawn a subagent. background returns immediately; end your turn; harness resumes when done; do not poll terminal_output.',
    inputSchema: z.object({
      agentName: z
        .string()
        .describe(
          'Catalog name (frontmatter name, filename stem, or slug). Verb phrases only for generic helpers not in the catalog.',
        ),
      prompt: z.string().describe('Task instructions for the subagent'),
      mode: z
        .enum(['blocking', 'background'])
        .default('blocking')
        .describe('blocking (default) or background'),
      model: z
        .string()
        .optional()
        .describe('Exact provider::modelId from resolve_models. Fuzzy names are rejected.'),
      capabilities: z
        .enum(['read-only', 'write'])
        .default('read-only')
        .describe(
          'write required for edit/write/delete/move or shell/git mutations; read-only (default) can only report',
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
      if (READ_ONLY_SPAWN_MODES.has(ctx.mode) && resolvedCapabilities === 'write') {
        throw new Error(
          `Write-capable subagents are not allowed in ${ctx.mode} mode. Spawn with capabilities: "read-only" (the default).`,
        )
      }

      const subagentId = crypto.randomUUID()
      const lockedSubagentModel = getPlanExecutionSession(
        ctx.projectSlug,
        ctx.chatId,
      ).subagentModel
      const agentDefinition = await validateSpawnAgentName(
        ctx.projectRoot,
        agentName,
      )
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

            resolveSubagent(subagentId, {
              subagentId,
              name: agentName,
              summary,
            })
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

        resolveSubagent(subagentId, {
          subagentId,
          name: agentName,
          summary,
        })
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
