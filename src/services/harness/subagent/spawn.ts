import { tool } from 'ai'
import { z } from 'zod'
import { noPoll, visibleStatus } from '@/services/harness/guidance'
import { getPlanExecutionSession } from '@/services/harness/plan-execution-session'
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
import resolveAgentDefinition from '@/services/agents/resolve-agent-definition'
import { READ_ONLY_SPAWN_MODES } from '@/services/harness/subagent/constants'
import linkAbortSignal from '@/utils/link-abort-signal'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const spawnSubagent = (ctx: HarnessToolContext) =>
  tool({
    description: `Spawn a subagent. Background mode returns immediately. ${visibleStatus('spawned')} ${noPoll}`,
    inputSchema: z.object({
      agentName: z
        .string()
        .describe(
          'Catalog name for a custom agent, or a short verb phrase label for the task such as Review auth changes',
        ),
      prompt: z.string().describe('Task instructions'),
      mode: z.enum(['blocking', 'background']).default('blocking'),
      model: z.string().optional().describe('Exact provider::modelId from resolve_models'),
      capabilities: z
        .enum(['read-only', 'write'])
        .default('read-only')
        .describe(
          'read-only runs tests, lint, git log, git diff, and gh in a sandbox with the project read-only; write can edit files',
        ),
    }),
    execute: async (
      { agentName, prompt, mode, model: callModel, capabilities },
      { toolCallId },
    ): Promise<
      | { subagentId: string; name: string; summary: string }
      | {
          subagentId: string
          name: string
          status: 'running'
          note: string
        }
    > => {
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
      // Background must outlive parent-turn abort; explicit stop/abortOne still halt them.
      if (blocking) {
        linkAbortSignal(ctx.signal, controller)
      }

      registerSubagent(
        ctx.chatId,
        subagentId,
        controller,
        {
          toolCallId,
          agentName,
          prompt,
          model,
          capabilities: resolvedCapabilities,
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
              aborted: controller.signal.aborted,
            })
          }
        }

        completeSubagent().catch((error) => {
          finishSubagentWithError(ctx, {
            subagentId,
            error,
            blocking: false,
            aborted: controller.signal.aborted,
          })
        })

        return {
          subagentId,
          name: agentName,
          status: 'running',
          note: `${visibleStatus('spawned')} ${noPoll}`,
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
          aborted: controller.signal.aborted,
        })
        throw error
      }
    },
  })

export default spawnSubagent
