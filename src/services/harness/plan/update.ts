import { tool } from 'ai'
import { z } from 'zod'
import parsePlan from '@/services/plans/parse-plan'
import { updatePlanBody } from '@/services/plans/write-plan'
import { fsReadFile, fsWriteFile } from '@/services/vixl/vixl-tauri'
import useWorkbenchStore from '@/composables/use-workbench-store'
import { HOME_WORKSPACE_ID, isHomeChatSlug } from '@/constants/home-chat'
import {
  getPlanExecutionSession,
  resolvePlanPath,
} from '@/services/harness/plan-execution-session'
import {
  joinOntoProjectRoot,
  resolvePlanToolPath,
  toWorkspaceRelativePath,
} from '@/services/harness/tool-roots'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const updatePlan = (ctx: HarnessToolContext) =>
  tool({
    description:
      'Replace an existing PLAN.md body and optionally its title. planPath defaults to the most recent plan; pass it when the chat has several. Todos go through update_plan_todo.',
    inputSchema: z.object({
      planPath: z.string().optional(),
      body: z.string().describe('Replacement plan body'),
      title: z.string().optional().describe('New frontmatter title'),
    }),
    execute: async ({ planPath, body, title }) => {
      const session = getPlanExecutionSession(ctx.projectSlug, ctx.chatId)
      const resolvedPlanPath = resolvePlanPath(planPath, session.activePlanPath)
      if (!resolvedPlanPath) {
        return {
          error:
            'No active plan was found. Pass planPath, or create a plan first.',
        }
      }
      const target = resolvePlanToolPath(ctx, resolvedPlanPath)
      const existing = await fsReadFile({
        projectRoot: target.projectRoot,
        path: target.relativePath,
      })
      const parsed = parsePlan(existing.content)
      if (parsed.parseError) {
        throw new Error(parsed.parseError)
      }
      const nextContent = updatePlanBody(existing.content, { body, title })
      await fsWriteFile({
        projectRoot: target.projectRoot,
        path: target.relativePath,
        content: nextContent,
      })
      const workbench = useWorkbenchStore()
      let projectId: string | null = null
      if (isHomeChatSlug(ctx.projectSlug)) {
        await workbench.ensureHomeRoot()
        projectId = HOME_WORKSPACE_ID
      } else {
        projectId = workbench.resolveProjectIdByRoot(target.projectRoot)
      }
      const nextTitle = title ?? parsed.frontmatter!.title
      if (projectId) {
        await workbench.openPlan(
          projectId,
          parsed.frontmatter!.id,
          target.relativePath,
          nextTitle,
        )
        workbench.refreshPlanTabs()
      }
      return {
        planPath: joinOntoProjectRoot(target.projectRoot, target.relativePath),
        relativePath: toWorkspaceRelativePath(
          { ...ctx, projectRoot: target.projectRoot },
          target.relativePath,
        ),
        title: nextTitle,
      }
    },
  })

export default updatePlan
