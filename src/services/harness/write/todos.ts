import { tool } from 'ai'
import { z } from 'zod'
import { planTodoItemPatchSchema, planTodoItemSchema } from '@/schemas/plan-document'
import useChatStore from '@/composables/use-chat-store'
import mergeInChatTodos from '@/services/harness/write/merge-in-chat-todos'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const updateTodos = (ctx: HarnessToolContext) =>
  tool({
    description:
      'Merge in-chat todos by id into the Tasks list. Matching ids update the provided fields, new ids append, and unmentioned todos keep their state. New ids must include content. Each todo is one short verb-first actionable line.',
    inputSchema: z.object({
      todos: z
        .array(planTodoItemPatchSchema)
        .describe(
          'Todo patches. id is required. content and status are optional for existing ids. New ids must include content.',
        ),
    }),
    execute: async ({ todos }) => {
      const existing = useChatStore().forChat(ctx.projectSlug, ctx.chatId).todos.value
      const merged = mergeInChatTodos(existing, todos)
      return { todos: z.array(planTodoItemSchema).parse(merged) }
    },
  })

export default updateTodos
