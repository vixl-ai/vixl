import { tool } from 'ai'
import createPlan from '@/services/plans/write-plan'
import createPlanInputSchema from '@/schemas/plans/create-plan-input'
import { fsWriteFile, updateChatMeta } from '@/services/vixl/vixl-tauri'
import useWorkbenchStore from '@/composables/use-workbench-store'
import {
  assertCreatePlanNotAwaitingPlanGo,
  markCreatedPlanThisTurn,
} from '@/services/harness/plan-execution-session'
import withToolExamples from '@/services/harness/with-tool-examples'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const createPlanTool = (ctx: HarnessToolContext) =>
  tool({
    description: withToolExamples(
      'Create a plan file under .vixl/plans/. After success, stop and wait for the user to click Build now or Orchestrate.',
      [
        {
          title: 'Add harness tool examples',
          body: '## Goal\nSurface usage examples on high-friction tools.\n',
          todos: [
            { id: 'helper', content: 'Add with-tool-examples helper', status: 'pending' },
          ],
        },
      ],
    ),
    inputSchema: createPlanInputSchema,
    execute: async ({ title, body, todos }) => {
      assertCreatePlanNotAwaitingPlanGo(ctx.projectSlug, ctx.chatId)
      const planTodos = todos ?? []
      const plan = createPlan({ title, body, todos: planTodos, sourceChatId: ctx.chatId })
      await fsWriteFile({ projectRoot: ctx.projectRoot, path: plan.path, content: plan.content })
      const awaiting = { planPath: plan.path, planId: plan.planId }
      markCreatedPlanThisTurn(ctx.projectSlug, ctx.chatId, awaiting)
      await updateChatMeta(ctx.projectSlug, ctx.chatId, {
        awaitingPlanGo: awaiting,
      })
      const workbench = useWorkbenchStore()
      const projectId = workbench.resolveProjectIdByRoot(ctx.projectRoot)
      if (projectId) {
        workbench.openPlan(projectId, plan.planId, plan.path, title)
      }
      return {
        planId: plan.planId,
        path: plan.path,
        todos: planTodos,
        awaitingGo: true,
        message:
          'Plan created. Stop and wait for the user to click Build now or Orchestrate on the plan tab before making any further changes.',
      }
    },
  })

export default createPlanTool
