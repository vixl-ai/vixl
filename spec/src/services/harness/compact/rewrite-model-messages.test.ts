import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import {
  compactBudgets,
  rewriteModelMessages,
} from '@/services/harness/compact'
import estimateTextTokens from '@/utils/estimate-text-tokens'

const user = (content: string): ModelMessage => ({
  role: 'user',
  content,
})

const assistant = (content: string): ModelMessage => ({
  role: 'assistant',
  content,
})

const framedFirstUser = (text: string): string =>
  `${compactBudgets.FIRST_USER_PREFIX}\n${text}`

const pinnedContent = (message: ModelMessage | undefined): unknown =>
  message && 'content' in message ? message.content : ''

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

    expect(pinnedContent(rewritten[0])).toBe(
      framedFirstUser('Spawn: find the auth bug in login.'),
    )
    expect(rewritten.filter((message) => message === firstTask)).toHaveLength(0)

    const checkpoint = rewritten[1]
    expect(checkpoint?.role).toBe('user')
    expect(checkpoint && 'content' in checkpoint ? checkpoint.content : '').toBe(
      `${compactBudgets.CHECKPOINT_PREFIX}\n${summary}`,
    )

    expect(rewritten).toHaveLength(4)
    expect(rewritten[2]).toEqual(tailUser)
    expect(rewritten[3]).toEqual(tailAssistant)
    expect(rewritten).not.toContain(middleDump)
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

  it('keeps the newest image and placeholders older screenshots', () => {
    const firstTask = user('Spawn: find the auth bug in login.')
    const olderImageUser: ModelMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'Inspect this old screenshot.' },
        {
          type: 'file',
          mediaType: 'image/png',
          data: 'A'.repeat(8_000),
        },
      ],
    }
    const newestImageUser: ModelMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'Inspect this latest screenshot.' },
        {
          type: 'file',
          mediaType: 'image/png',
          data: 'B'.repeat(8_000),
        },
      ],
    }
    const summary = 'Auth login fails when the token is expired.'

    const rewritten = rewriteModelMessages(
      [firstTask, olderImageUser, newestImageUser],
      summary,
    )

    const serialized = JSON.stringify(rewritten)
    expect(serialized).not.toContain('A'.repeat(1000))
    expect(serialized).toContain('[image omitted by compaction]')
    expect(serialized).toContain('B'.repeat(1000))
    expect(serialized).toContain('Inspect this latest screenshot.')
    expect(rewritten).toContain(newestImageUser)
  })

  it('skips an oversize middle message instead of dropping older recent turns', () => {
    const firstTask = user('Spawn: find the auth bug in login.')
    const olderAssistant = assistant('Keep this recent finding.')
    const oversize = assistant('x'.repeat(40_000))
    const tailUser = user('What is left to fix?')
    const tailAssistant = assistant('Write a regression test next.')
    const summary = 'Auth login fails when the token is expired.'

    const rewritten = rewriteModelMessages(
      [firstTask, olderAssistant, oversize, tailUser, tailAssistant],
      summary,
    )

    expect(rewritten).toContain(olderAssistant)
    expect(rewritten).toContain(tailUser)
    expect(rewritten).toContain(tailAssistant)
    expect(rewritten).not.toContain(oversize)
  })

  it('keeps the latest user and assistant text even when they exceed the window', () => {
    const firstTask = user('Spawn: find the auth bug in login.')
    const latestUser = user('y'.repeat(50_000))
    const latestAssistant = assistant('z'.repeat(50_000))
    const summary = 'Auth login fails when the token is expired.'

    const rewritten = rewriteModelMessages(
      [firstTask, latestUser, latestAssistant],
      summary,
    )

    expect(pinnedContent(rewritten[0])).toBe(
      framedFirstUser('Spawn: find the auth bug in login.'),
    )
    const kept = rewritten.slice(2)
    expect(kept).toHaveLength(2)
    expect(kept[0]?.role).toBe('user')
    expect(kept[1]?.role).toBe('assistant')
    expect(JSON.stringify(kept[0])).toContain('[truncated for compaction]')
    expect(JSON.stringify(kept[1])).toContain('[truncated for compaction]')
    expect(JSON.stringify(rewritten)).not.toContain('y'.repeat(50_000))
    expect(JSON.stringify(rewritten)).not.toContain('z'.repeat(50_000))
  })

  it('placeholders file parts on the pinned first user message', () => {
    const firstTask: ModelMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'Spawn: inspect this screenshot.' },
        {
          type: 'file',
          mediaType: 'image/png',
          data: 'B'.repeat(80_000),
        },
      ],
    }
    const tailAssistant = assistant('I will inspect login.ts next.')
    const rewritten = rewriteModelMessages(
      [firstTask, tailAssistant],
      'Auth recap',
    )

    expect(rewritten[0]?.role).toBe('user')
    expect(JSON.stringify(rewritten[0])).toContain(
      compactBudgets.FIRST_USER_PREFIX,
    )
    expect(JSON.stringify(rewritten[0])).toContain(
      'Spawn: inspect this screenshot.',
    )
    expect(JSON.stringify(rewritten[0])).toContain(
      '[image omitted by compaction]',
    )
    expect(JSON.stringify(rewritten[0])).not.toContain('B'.repeat(1000))
    expect(rewritten[0]).not.toBe(firstTask)
    expect(rewritten).toContain(tailAssistant)
  })

  it('does not pin a leading checkpoint as the first user on a second compact', () => {
    const priorCheckpoint = user(
      `${compactBudgets.CHECKPOINT_PREFIX}\nprior recap`,
    )
    const firstTask = user('Spawn: find the auth bug in login.')
    const tailUser = user('What is left to fix?')
    const tailAssistant = assistant('Write a regression test next.')
    const summary = 'Auth login fails when the token is expired.'

    const rewritten = rewriteModelMessages(
      [priorCheckpoint, firstTask, tailUser, tailAssistant],
      summary,
    )

    expect(pinnedContent(rewritten[0])).toBe(
      framedFirstUser('Spawn: find the auth bug in login.'),
    )
    expect(pinnedContent(rewritten[1])).toBe(
      `${compactBudgets.CHECKPOINT_PREFIX}\n${summary}`,
    )
    expect(JSON.stringify(rewritten)).not.toContain(
      `${compactBudgets.FIRST_USER_PREFIX}\n${compactBudgets.CHECKPOINT_PREFIX}`,
    )
    expect(rewritten).toContain(priorCheckpoint)
    expect(rewritten).toContain(tailUser)
    expect(rewritten).toContain(tailAssistant)
  })

  it('frames the pinned first user as history, not live instructions', () => {
    const firstTask = user('Please come up with an RCA')
    const tailUser = user('What is left to fix?')
    const rewritten = rewriteModelMessages(
      [firstTask, tailUser],
      'RCA already delivered.',
    )

    expect(pinnedContent(rewritten[0])).toBe(
      framedFirstUser('Please come up with an RCA'),
    )
    expect(rewritten).not.toContain(firstTask)
  })

  it('does not nest FIRST_USER_PREFIX when rewrite runs a second time', () => {
    const firstTask = user('Spawn: find the auth bug in login.')
    const tailUser = user('What is left to fix?')
    const tailAssistant = assistant('Write a regression test next.')

    const firstRewrite = rewriteModelMessages(
      [firstTask, tailUser, tailAssistant],
      'Auth login fails when the token is expired.',
    )
    const secondRewrite = rewriteModelMessages(
      firstRewrite,
      'Second compact: token refresh still broken.',
    )

    const first = secondRewrite[0]
    expect(first?.role).toBe('user')
    const content =
      first && typeof first.content === 'string' ? first.content : ''
    expect(content).toBe(framedFirstUser('Spawn: find the auth bug in login.'))
    expect(content.split(compactBudgets.FIRST_USER_PREFIX)).toHaveLength(2)
    expect(content).not.toContain(
      `${compactBudgets.FIRST_USER_PREFIX}\n${compactBudgets.FIRST_USER_PREFIX}`,
    )
  })

  it('truncates a giant first user message and keeps the history prefix', () => {
    const firstTask = user(`Please come up with an RCA\n${'email thread '.repeat(20_000)}`)
    const tailUser = user('What is left to fix?')
    const rewritten = rewriteModelMessages(
      [firstTask, tailUser],
      'RCA already delivered.',
    )

    const first = rewritten[0]
    expect(first?.role).toBe('user')
    const content =
      first && typeof first.content === 'string' ? first.content : ''
    expect(content.startsWith(compactBudgets.FIRST_USER_PREFIX)).toBe(true)
    expect(content).toContain('Please come up with an RCA')
    expect(content).toContain('[truncated for compaction]')
    expect(content).not.toContain('email thread '.repeat(5_000))
    expect(estimateTextTokens(JSON.stringify(first))).toBeLessThanOrEqual(
      compactBudgets.FIRST_USER_TOKEN_BUDGET + 1,
    )
  })
})
