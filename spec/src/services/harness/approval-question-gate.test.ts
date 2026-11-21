import { beforeEach, describe, expect, it } from 'vitest'
import {
  listPendingApprovalsForChat,
  rejectPendingForChat,
  requestApproval,
  resetApprovalGateForTests,
  resolveApproval,
} from '@/services/harness/permission/approval-gate'
import {
  listPendingQuestionsForChat,
  rejectPendingQuestionsForChat,
  requestQuestion,
  resetQuestionGateForTests,
  resolveQuestion,
} from '@/services/harness/permission/question-gate'

describe('approval and question gates scoped by chat', () => {
  beforeEach(() => {
    resetApprovalGateForTests()
    resetQuestionGateForTests()
  })

  it('rejectPendingForChat does not clear another chat approval', async () => {
    const approvalA = requestApproval({
      chatId: 'chat-a',
      toolCallId: 'tool-a',
      name: 'write_file',
      kind: 'fs',
      action: 'fs.write',
      capability: 'fs.write:a.txt',
      title: 'Write A',
      allowedScopes: ['once', 'session', 'always'],
    })
    const approvalB = requestApproval({
      chatId: 'chat-b',
      toolCallId: 'tool-b',
      name: 'write_file',
      kind: 'fs',
      action: 'fs.write',
      capability: 'fs.write:b.txt',
      title: 'Write B',
      allowedScopes: ['once', 'session', 'always'],
    })

    expect(listPendingApprovalsForChat('chat-a')).toHaveLength(1)
    expect(listPendingApprovalsForChat('chat-b')).toHaveLength(1)

    rejectPendingForChat('chat-a')

    await expect(approvalA).resolves.toEqual({ approved: false, scope: 'once' })
    expect(listPendingApprovalsForChat('chat-a')).toHaveLength(0)
    expect(listPendingApprovalsForChat('chat-b')).toHaveLength(1)

    resolveApproval('tool-b', { approved: true, scope: 'once' })
    await expect(approvalB).resolves.toEqual({ approved: true, scope: 'once' })
  })

  it('rejectPendingQuestionsForChat does not clear another chat question', async () => {
    const questionA = requestQuestion('chat-a', 'q-a', 'Question A?')
    const questionB = requestQuestion('chat-b', 'q-b', 'Question B?')

    expect(listPendingQuestionsForChat('chat-a')).toHaveLength(1)
    expect(listPendingQuestionsForChat('chat-b')).toHaveLength(1)

    rejectPendingQuestionsForChat('chat-a')

    await expect(questionA).rejects.toThrow('Question cancelled')
    expect(listPendingQuestionsForChat('chat-a')).toHaveLength(0)
    expect(listPendingQuestionsForChat('chat-b')).toHaveLength(1)

    resolveQuestion('q-b', 'answer')
    await expect(questionB).resolves.toBe('answer')
  })

  it('keeps batched questions on the pending entry', async () => {
    const questions = [{ question: 'Question A?' }, { question: 'Question B?', options: ['x'] }]
    const batched = requestQuestion('chat-a', 'q-batch', 'Question A?', undefined, questions)

    const entry = listPendingQuestionsForChat('chat-a')[0]
    expect(entry?.questions).toEqual(questions)

    resolveQuestion('q-batch', 'combined answer')
    await expect(batched).resolves.toBe('combined answer')
    expect(listPendingQuestionsForChat('chat-a')).toHaveLength(0)
  })
})
