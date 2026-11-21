import { tool } from 'ai'
import { z } from 'zod'
import { requestQuestion } from '@/services/harness/permission/question-gate'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { QuestionItem } from '@/types/harness/question-item'

const askUser = (ctx: HarnessToolContext) =>
  tool({
    description:
      'Ask the user clarifying questions. Batch related questions into one call, not separate calls.',
    inputSchema: z.object({
      questions: z.array(
        z.object({
          question: z.string(),
          options: z.array(z.string()).optional(),
        }),
      ),
    }),
    execute: async ({ questions }, { toolCallId }) => {
      const items: QuestionItem[] = questions ?? []
      const first = items[0]
      if (!first) {
        throw new Error('Provide at least one question')
      }
      if (ctx.signal?.aborted) {
        throw new Error('Question cancelled')
      }
      const batch = items.length > 1 ? items : undefined
      ctx.onHarnessEvent?.({
        type: 'question-request',
        toolCallId,
        question: first.question,
        options: first.options,
        questions: batch,
      })
      const answer = await requestQuestion(
        ctx.chatId,
        toolCallId,
        first.question,
        first.options,
        batch,
      )
      if (ctx.signal?.aborted) {
        throw new Error('Question cancelled')
      }
      return batch
        ? { questions: items, answer }
        : { question: first.question, answer, options: first.options }
    },
  })

export default askUser