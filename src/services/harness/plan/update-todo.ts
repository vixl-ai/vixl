import { tool } from 'ai'
import { z } from 'zod'
import { planTodoItemPatchSchema, planTodoItemSchema } from '@/schemas/plan-document'
import parsePlan from '@/services/plans/parse-plan'
import { mergePlanTodos, updatePlanTodos } from '@/services/plans/write-plan'
import mergeInChatTodos from '@/services/harness/write/merge-in-chat-todos'
import { fsReadFile, fsWriteFile } from '@/services/vixl/vixl-tauri'
import useChatStore from '@/composables/use-chat-store'
import useWorkbenchStore from '@/composables/use-workbench-store'
import { HOME_WORKSPACE_ID, isHomeChatSlug } from '@/constants/home-chat'
import {
  getPlanExecutionSession,
  resolveUpdatePlanTodoPath,
} from '@/services/harness/plan-execution-session'
import { listSubagentsForChat } from '@/services/harness/subagent/registry'
import {
  joinOntoProjectRoot,
  resolvePlanToolPath,
  toWorkspaceRelativePath,
} from '@/services/harness/tool-roots'
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
  inputTodos: Array<{ status?: string }>,
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
      todos: z
        .array(planTodoItemPatchSchema)
        .describe(
          'Todo patches. id is required. content and status are optional for existing ids. New ids must include content.',
        ),
    }),
    execute: async ({ planPath, todos }) => {
      const session = getPlanExecutionSession(ctx.projectSlug, ctx.chatId)
      const resolvedPlanPath = resolveUpdatePlanTodoPath(
        planPath,
        session.activePlanPath,
      )
      if (!resolvedPlanPath) {
        const existing = useChatStore().forChat(ctx.projectSlug, ctx.chatId).todos.value
        const merged = mergeInChatTodos(existing, todos)
        return withRunningSubagentContext(ctx.chatId, todos, {
          todos: z.array(planTodoItemSchema).parse(merged),
        })
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
      const merged = mergePlanTodos(parsed.frontmatter?.todos ?? [], todos)
      const nextContent = updatePlanTodos(existing.content, merged)
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
      if (projectId) {
        await workbench.openPlan(
          projectId,
          parsed.frontmatter!.id,
          target.relativePath,
          parsed.frontmatter!.title,
        )
        workbench.refreshPlanTabs()
      }
      return withRunningSubagentContext(ctx.chatId, todos, {
        planPath: joinOntoProjectRoot(target.projectRoot, target.relativePath),
        relativePath: toWorkspaceRelativePath(
          { ...ctx, projectRoot: target.projectRoot },
          target.relativePath,
        ),
        todos: merged,
      })
    },
  })

export default updatePlanTodo
