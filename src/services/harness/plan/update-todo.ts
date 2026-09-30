import { tool } from 'ai'
import { z } from 'zod'
import { planTodoItemSchema } from '@/schemas/plan-document'
import parsePlan from '@/services/plans/parse-plan'
import { mergePlanTodos, updatePlanTodos } from '@/services/plans/write-plan'
import { fsReadFile, fsWriteFile } from '@/services/vixl/vixl-tauri'
import useWorkbenchStore from '@/composables/use-workbench-store'
import { HOME_WORKSPACE_ID, isHomeChatSlug } from '@/constants/home-chat'
import {
  getPlanExecutionSession,
  resolveUpdatePlanTodoPath,
} from '@/services/harness/plan-execution-session'
import { listSubagentsForChat } from '@/services/harness/subagent/registry'
import type { HarnessToolContext } from '@/types/harness/tool-context'

type RunningSubagentHint = {
  subagentId: string
  name: string
}

const listRunningSubagentHints = (chatId: string): RunningSubagentHint[] =>
  listSubagentsForChat(chatId)
    .filter((record) => record.status === 'running')
    .map((record) => ({
      subagentId: record.subagentId,
      name: record.agentName,
    }))

const withRunningSubagentContext = <T extends Record<string, unknown>>(
  chatId: string,
  inputTodos: Array<{ status: string }>,
  result: T,
): T | (T & { runningSubagents: RunningSubagentHint[]; note?: string }) => {
  const runningSubagents = listRunningSubagentHints(chatId)
  if (runningSubagents.length === 0) {
    return result
  }
  const completing = inputTodos.some((todo) => todo.status === 'completed')
  if (!completing) {
    return { ...result, runningSubagents }
  }
  const runningList = runningSubagents
    .map((item) => `${item.name} (${item.subagentId})`)
    .join(', ')
  return {
    ...result,
    runningSubagents,
    note: `Background subagents still running: ${runningList}. Mark a todo completed only after its subagent result arrives.`,
  }
}

const updatePlanTodo = (ctx: HarnessToolContext) =>
  tool({
    description:
      'Merge todos by id into a plan: matching ids update, new ids append, others keep their state. Mark a todo cancelled to drop it. planPath defaults to the active plan, or in-chat Tasks when none exists.',
    inputSchema: z.object({
      planPath: z.string().optional(),
      todos: z.array(
        z.object({
          id: z.string().describe('Stable todo id'),
          content: z.string(),
          status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
        }),
      ),
    }),
    execute: async ({ planPath, todos }) => {
      const session = getPlanExecutionSession(ctx.projectSlug, ctx.chatId)
      const resolvedPlanPath = resolveUpdatePlanTodoPath(
        planPath,
        session.activePlanPath,
      )
      if (!resolvedPlanPath) {
        return withRunningSubagentContext(ctx.chatId, todos, {
          todos: z.array(planTodoItemSchema).parse(todos),
        })
      }
      const existing = await fsReadFile({
        projectRoot: ctx.projectRoot,
        path: resolvedPlanPath,
      })
      const parsed = parsePlan(existing.content)
      if (parsed.parseError) {
        throw new Error(parsed.parseError)
      }
      const merged = mergePlanTodos(parsed.frontmatter?.todos ?? [], todos)
      const nextContent = updatePlanTodos(existing.content, merged)
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
      if (projectId) {
        await workbench.openPlan(
          projectId,
          parsed.frontmatter!.id,
          resolvedPlanPath,
          parsed.frontmatter!.title,
        )
        workbench.refreshPlanTabs()
      }
      return withRunningSubagentContext(ctx.chatId, todos, {
        planPath: resolvedPlanPath,
        todos: merged,
      })
    },
  })

export default updatePlanTodo
