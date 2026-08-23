import type { TodoItem } from '@/types/harness/harness-event'

const parseTodoUpdate = (name: string, result: unknown): TodoItem[] | null => {
  // write_todos is a legacy tool name kept for historical chat lines
  if (
    name !== 'create_plan' &&
    name !== 'update_plan_todo' &&
    name !== 'update_todos' &&
    name !== 'write_todos'
  ) {
    return null
  }
  if (!result || typeof result !== 'object' || !('todos' in result)) {
    return null
  }
  const todos = (result as { todos: unknown }).todos
  if (!Array.isArray(todos)) {
    return null
  }
  return todos as TodoItem[]
}

export default parseTodoUpdate
