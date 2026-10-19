import { tool } from 'ai'
import { z } from 'zod'
import {
  ensureFleetLoaded,
  getFleetProjects,
  refreshFleetProjects,
} from '@/composables/use-fleet-registry'
import { noPoll, visibleStatus } from '@/services/harness/guidance'
import { getPlanExecutionSession } from '@/services/harness/plan-execution-session'
import {
  register as registerSubagent,
  resolve as resolveSubagent,
} from '@/services/harness/subagent/registry'
import {
  emitSubagentResult,
  finishSubagentWithError,
  subagentStopForFinish,
} from '@/services/harness/subagent/helpers'
import resolveSpawnModel from '@/services/harness/subagent/resolve-spawn-model'
import runSubagentGenerate from '@/services/harness/subagent/run-generate'
import resolveAgentDefinition from '@/services/agents/resolve-agent-definition'
import { READ_ONLY_SPAWN_MODES } from '@/services/harness/subagent/constants'
import linkAbortSignal from '@/utils/link-abort-signal'
import pathsEqual from '@/utils/paths-equal'
import type { FleetProject } from '@/types/fleet/fleet-project'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { SubagentWorkspace } from '@/types/harness/subagent-record'

const ancestorOf = (project: FleetProject): string =>
  project.worktree?.parentId ?? project.id

const resolveSpawnWorkspace = async (
  ctx: HarnessToolContext,
  workspaceSlug: string | undefined,
): Promise<SubagentWorkspace | undefined> => {
  const slug = workspaceSlug?.trim()
  if (!slug) {
    return undefined
  }

  await ensureFleetLoaded()
  let projects = getFleetProjects()
  let target = projects.find((project) => project.slug === slug)
  if (!target) {
    await refreshFleetProjects()
    projects = getFleetProjects()
    target = projects.find((project) => project.slug === slug)
  }
  if (!target) {
    throw new Error(`Unknown workspace slug: ${slug}`)
  }

  const current =
    projects.find((project) => pathsEqual(project.rootPath, ctx.projectRoot)) ??
    projects.find((project) => project.slug === ctx.projectSlug)
  const isWorktreeChild = Boolean(
    current &&
      target.worktree &&
      ancestorOf(target) === ancestorOf(current),
  )
  const isGroupMember = Boolean(ctx.members?.some((member) => member.slug === slug))
  if (!isWorktreeChild && !isGroupMember) {
    throw new Error(
      `workspaceSlug ${slug} is not a worktree of this project or a member of the current group`,
    )
  }

  return { projectRoot: target.rootPath, projectSlug: target.slug }
}

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
      workspaceSlug: z
        .string()
        .optional()
        .describe('Worktree child or group-member slug'),
    }),
    execute: async (
      { agentName, prompt, mode, model: callModel, capabilities, workspaceSlug },
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

      const workspace = await resolveSpawnWorkspace(ctx, workspaceSlug)

      const subagentId = crypto.randomUUID()
      const lockedSubagentModel = getPlanExecutionSession(
        ctx.projectSlug,
        ctx.chatId,
      ).subagentModel
      const agentDefinition = await resolveAgentDefinition(
        workspace?.projectRoot ?? ctx.projectRoot,
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
          ...(workspace ? { workspace } : {}),
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
            const generated = await runSubagentGenerate({
              ctx,
              subagentId,
              agentName,
              prompt,
              toolCallId,
              signal: controller.signal,
              model,
              capabilities: resolvedCapabilities,
              ...(workspace ? { workspace } : {}),
            })

            resolveSubagent(subagentId, {
              subagentId,
              name: agentName,
              summary: generated.text,
            })
            emitSubagentResult(ctx, {
              subagentId,
              summary: generated.text,
              blocking: false,
              outcome: 'completed',
              stop: subagentStopForFinish(generated.finishReason),
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
        const generated = await runSubagentGenerate({
          ctx,
          subagentId,
          agentName,
          prompt,
          toolCallId,
          signal: controller.signal,
          model,
          capabilities: resolvedCapabilities,
          ...(workspace ? { workspace } : {}),
        })

        resolveSubagent(subagentId, {
          subagentId,
          name: agentName,
          summary: generated.text,
        })
        emitSubagentResult(ctx, {
          subagentId,
          summary: generated.text,
          blocking: true,
          outcome: 'completed',
          stop: subagentStopForFinish(generated.finishReason),
        })

        return { subagentId, name: agentName, summary: generated.text }
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
