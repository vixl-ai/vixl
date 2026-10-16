import {
  formatPlanSchemaError,
  planTodoItemSchema,
} from '@/schemas/plan-document'
import type { PlanTodoItem } from '@/types/plans/plan-document'

export type InChatTodoPatch = {
  id: string
  content?: string
  status?: PlanTodoItem['status']
}

const mergeInChatTodos = (
  existing: PlanTodoItem[],
  incoming: InChatTodoPatch[],
): PlanTodoItem[] => {
  const merged = [...existing]
  for (const patch of incoming) {
    const index = merged.findIndex((item) => item.id === patch.id)
    if (index === -1) {
      if (patch.content === undefined) {
        throw new Error(
          `Cannot append todo ${patch.id}: content is required for new ids`,
        )
      }
      const parsed = planTodoItemSchema.safeParse({
        id: patch.id,
        content: patch.content,
        status: patch.status ?? 'pending',
      })
      if (!parsed.success) {
        throw new Error(
          `Cannot append todo ${patch.id}: ${formatPlanSchemaError(parsed.error)}`,
        )
      }
      merged.push(parsed.data)
      continue
    }
    const current = merged[index]
    if (!current) {
      continue
    }
    merged[index] = {
      id: current.id,
      content: patch.content ?? current.content,
      status: patch.status ?? current.status,
    }
  }
  return merged
}

export default mergeInChatTodos
