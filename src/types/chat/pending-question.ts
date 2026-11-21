import type { QuestionItem } from '@/types/harness/question-item'

export type PendingQuestionState = {
  toolCallId: string
  question: string
  options?: string[]
  /** Present when one ask_user call batches multiple questions. */
  questions?: QuestionItem[]
}
