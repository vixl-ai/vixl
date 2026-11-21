import type { QuestionItem } from '@/types/harness/question-item'

export type PendingQuestion = {
  chatId: string
  toolCallId: string
  question: string
  options?: string[]
  questions?: QuestionItem[]
  resolve: (answer: string) => void
  reject: (error: Error) => void
}

const pending = new Map<string, PendingQuestion>()

export const requestQuestion = (
  chatId: string,
  toolCallId: string,
  question: string,
  options?: string[],
  questions?: QuestionItem[],
): Promise<string> =>
  new Promise((resolve, reject) => {
    pending.set(toolCallId, {
      chatId,
      toolCallId,
      question,
      options,
      questions,
      resolve,
      reject,
    })
  })

export const getPendingQuestion = (toolCallId: string): PendingQuestion | undefined =>
  pending.get(toolCallId)

export const listPendingQuestionsForChat = (chatId: string): PendingQuestion[] =>
  [...pending.values()].filter((entry) => entry.chatId === chatId)

export const resolveQuestion = (toolCallId: string, answer: string): void => {
  const entry = pending.get(toolCallId)
  if (!entry) {
    return
  }
  pending.delete(toolCallId)
  entry.resolve(answer)
}

export const rejectPendingQuestionsForChat = (chatId: string): void => {
  for (const [toolCallId, entry] of pending.entries()) {
    if (entry.chatId !== chatId) {
      continue
    }
    pending.delete(toolCallId)
    entry.reject(new Error('Question cancelled'))
  }
}

export const resetQuestionGateForTests = (): void => {
  pending.clear()
}
