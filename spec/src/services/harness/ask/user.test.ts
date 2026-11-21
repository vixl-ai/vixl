import { beforeEach, describe, expect, it, vi } from 'vitest'
import askUser from '@/services/harness/ask/user'
import {
  listPendingQuestionsForChat,
  resetQuestionGateForTests,
  resolveQuestion,
} from '@/services/harness/permission/question-gate'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const makeCtx = (signal?: AbortSignal): HarnessToolContext => ({
  projectRoot: '/tmp/project',
  projectSlug: 'project',
  chatId: 'chat-1',
  mode: 'agent',
  settings: { version: 1 } as VixlSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set<string>(),
  sessionDenies: new Set<string>(),
  sandboxEnabled: false,
  supportsVision: false,
  onPendingApproval: vi.fn<(entry: PendingApprovalView) => void>(),
  onHarnessEvent: vi.fn<(event: HarnessEvent) => void>(),
  signal,
})

const runTool = (
  input: Record<string, unknown>,
  ctx: HarnessToolContext,
  toolCallId = 'tc-ask',
): Promise<unknown> => {
  const built = askUser(ctx)
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId })
}

describe('ask_user', () => {
  beforeEach(() => {
    resetQuestionGateForTests()
  })

  it('asks a single question and returns the answer', async () => {
    const ctx = makeCtx()
    const result = runTool(
      { questions: [{ question: 'Proceed?', options: ['Yes', 'No'] }] },
      ctx,
    )

    expect(ctx.onHarnessEvent).toHaveBeenCalledWith({
      type: 'question-request',
      toolCallId: 'tc-ask',
      question: 'Proceed?',
      options: ['Yes', 'No'],
      questions: undefined,
    })
    const pending = listPendingQuestionsForChat('chat-1')
    expect(pending).toHaveLength(1)
    expect(pending[0]?.questions).toBeUndefined()

    resolveQuestion('tc-ask', 'Yes')
    await expect(result).resolves.toEqual({
      question: 'Proceed?',
      answer: 'Yes',
      options: ['Yes', 'No'],
    })
  })

  it('batches questions into one gate entry and one event', async () => {
    const ctx = makeCtx()
    const questions = [
      { question: 'Which database?', options: ['Postgres', 'SQLite'] },
      { question: 'Which package manager?' },
    ]
    const result = runTool({ questions }, ctx)

    expect(ctx.onHarnessEvent).toHaveBeenCalledTimes(1)
    expect(ctx.onHarnessEvent).toHaveBeenCalledWith({
      type: 'question-request',
      toolCallId: 'tc-ask',
      question: 'Which database?',
      options: ['Postgres', 'SQLite'],
      questions,
    })
    const pending = listPendingQuestionsForChat('chat-1')
    expect(pending).toHaveLength(1)
    expect(pending[0]?.questions).toEqual(questions)

    resolveQuestion('tc-ask', '1. Which database?\nAnswer: Postgres')
    await expect(result).resolves.toEqual({
      questions,
      answer: '1. Which database?\nAnswer: Postgres',
    })
  })

  it('rejects when questions is empty', async () => {
    await expect(runTool({ questions: [] }, makeCtx())).rejects.toThrow(
      'Provide at least one question',
    )
  })

  it('rejects when the turn signal is already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      runTool({ questions: [{ question: 'Proceed?' }] }, makeCtx(controller.signal)),
    ).rejects.toThrow('Question cancelled')
    expect(listPendingQuestionsForChat('chat-1')).toHaveLength(0)
  })
})