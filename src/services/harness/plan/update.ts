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
import type { HarnessToolContext } from '@/types/harness/tool-context'

const updatePlan = (ctx: HarnessToolContext) =>
  tool({
    description:
      'Replace an existing PLAN.md body, optional title. Do not call create_plan again for an existing plan. Omit planPath to use the active plan. Todos stay with update_plan_todo.',
    inputSchema: z.object({
      planPath: z
        .string()
        .optional()
        .describe('PLAN.md path; omit for active plan'),
      body: z.string().describe('Replacement plan body'),
      title: z.string().optional().describe('New frontmatter title'),
    }),
    execute: async ({ planPath, body, title }) => {
      const session = getPlanExecutionSession(ctx.projectSlug, ctx.chatId)
      const resolvedPlanPath = resolvePlanPath(
        planPath,
        session.awaitingPlanGo,
        session.activePlanPath,
      )
      if (!resolvedPlanPath) {
        return {
          error:
            'No active plan was found. Pass planPath, or create a plan first.',
        }
      }
      const existing = await fsReadFile({
        projectRoot: ctx.projectRoot,
        path: resolvedPlanPath,
      })
      const parsed = parsePlan(existing.content)
      if (parsed.parseError) {
        throw new Error(parsed.parseError)
      }
      const nextContent = updatePlanBody(existing.content, { body, title })
      await fsWriteFile({
        projectRoot: ctx.projectRoot,
        path: resolvedPlanPath,
        content: nextContent,
      })
      const workbench = useWorkbenchStore()
      let projectId: string | null = null
      if (isHomeChatSlug(ctx.projectSlug)) {
        await workbench.ensureHomeRoot()
        projectId = HOME_WORKSPACE_ID
      } else {
        projectId = workbench.resolveProjectIdByRoot(ctx.projectRoot)
      }
      const nextTitle = title ?? parsed.frontmatter!.title
      if (projectId) {
        await workbench.openPlan(
          projectId,
          parsed.frontmatter!.id,
          resolvedPlanPath,
          nextTitle,
        )
        workbench.refreshPlanTabs()
      }
      return { planPath: resolvedPlanPath, title: nextTitle }
    },
  })

export default updatePlan
