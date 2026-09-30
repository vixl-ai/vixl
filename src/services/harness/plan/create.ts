import { tool } from 'ai'
import createPlan from '@/services/plans/write-plan'
import createPlanInputSchema from '@/schemas/plans/create-plan-input'
import { fsWriteFile, updateChatMeta } from '@/services/vixl/vixl-tauri'
import useWorkbenchStore from '@/composables/use-workbench-store'
import { HOME_WORKSPACE_ID, isHomeChatSlug } from '@/constants/home-chat'
import { markCreatedPlanThisTurn } from '@/services/harness/plan-execution-session'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const createPlanTool = (ctx: HarnessToolContext) =>
  tool({
    description:
      'Create a new plan under .vixl/plans/. A chat can hold many plans; the newest becomes the default for update_plan and update_plan_todo. After success, stop so the user can review.',
    inputSchema: createPlanInputSchema,
    execute: async ({ title, body, todos }) => {
      const planTodos = todos ?? []
      const plan = createPlan({ title, body, todos: planTodos, sourceChatId: ctx.chatId })
      await fsWriteFile({ projectRoot: ctx.projectRoot, path: plan.path, content: plan.content })
      markCreatedPlanThisTurn(ctx.projectSlug, ctx.chatId, plan.path)
      await updateChatMeta(ctx.projectSlug, ctx.chatId, {
        activePlanPath: plan.path,
        awaitingPlanGo: null,
      })
      const workbench = useWorkbenchStore()
      let projectId: string | null = null
      if (isHomeChatSlug(ctx.projectSlug)) {
        await workbench.ensureHomeRoot()
        projectId = HOME_WORKSPACE_ID
      } else {
        projectId = workbench.resolveProjectIdByRoot(ctx.projectRoot)
      }
      if (projectId) {
        await workbench.openPlan(projectId, plan.planId, plan.path, title)
      }
      return {
        planId: plan.planId,
        path: plan.path,
        todos: planTodos,
        message: 'Plan created. Stop here so the user can review it.',
      }
    },
  })

export default createPlanTool
