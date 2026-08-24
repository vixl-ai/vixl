import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import {
  compactBudgets,
  rewriteModelMessages,
} from '@/services/harness/compact'

const user = (content: string): ModelMessage => ({
  role: 'user',
  content,
})

const assistant = (content: string): ModelMessage => ({
  role: 'assistant',
  content,
})

describe('rewriteModelMessages', () => {
  it('keeps the first user task, checkpoint, and tail, dropping a middle dump', () => {
    const firstTask = user('Spawn: find the auth bug in login.')
    const middleDump = assistant('x'.repeat(40_000))
    const tailUser = user('What is left to fix?')
    const tailAssistant = assistant('Write a regression test next.')
    const summary = 'Auth login fails when the token is expired.'

    const rewritten = rewriteModelMessages(
      [firstTask, middleDump, tailUser, tailAssistant],
      summary,
    )

    expect(rewritten[0]).toEqual(firstTask)

    const checkpoint = rewritten[1]
    expect(checkpoint?.role).toBe('user')
    expect(checkpoint && 'content' in checkpoint ? checkpoint.content : '').toBe(
      `${compactBudgets.CHECKPOINT_PREFIX}\n${summary}`,
    )

    expect(rewritten).toHaveLength(4)
    expect(rewritten[2]).toEqual(tailUser)
    expect(rewritten[3]).toEqual(tailAssistant)
    expect(rewritten).not.toContain(middleDump)
    expect(
      rewritten.filter((message) => message === firstTask),
    ).toHaveLength(1)
  })

  it('still produces a valid list when there is no user message', () => {
    const onlyAssistant = assistant('Working without a spawn task.')
    const rewritten = rewriteModelMessages([onlyAssistant], 'checkpoint body')

    expect(rewritten[0]?.role).toBe('user')
    expect(
      rewritten[0] && 'content' in rewritten[0] ? rewritten[0].content : '',
    ).toContain(compactBudgets.CHECKPOINT_PREFIX)
    expect(rewritten).toContain(onlyAssistant)
  })
})
