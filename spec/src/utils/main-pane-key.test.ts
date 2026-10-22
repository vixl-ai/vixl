import { describe, expect, it } from 'vitest'
import {
  mainPaneKey,
  shouldFadeMainPane,
  type MainPaneFadeOptions,
  type MainPaneRoute,
} from '@/utils/main-pane-key'

const route = (
  path: string,
  params: MainPaneRoute['params'] = {},
  query?: MainPaneRoute['query'],
): MainPaneRoute => ({ path, params, query })

const allowFade: MainPaneFadeOptions = {
  reducedMotion: false,
  hasViewTransition: true,
  transitionInFlight: false,
}

describe('mainPaneKey', () => {
  it('uses slug home for a home chat route', () => {
    expect(mainPaneKey(route('/chat/c1', { chatId: 'c1' }))).toBe(
      'chat:home:c1',
    )
  })

  it('uses the project slug for a project chat route', () => {
    expect(
      mainPaneKey(
        route('/project/api/chat/c1', { slug: 'api', chatId: 'c1' }),
      ),
    ).toBe('chat:api:c1')
  })

  it('uses distinct keys for two chat ids', () => {
    expect(mainPaneKey(route('/chat/a', { chatId: 'a' }))).toBe(
      'chat:home:a',
    )
    expect(mainPaneKey(route('/chat/b', { chatId: 'b' }))).toBe(
      'chat:home:b',
    )
  })

  it('keeps the same key when opening a subagent', () => {
    const chat = route('/project/api/chat/c1', {
      slug: 'api',
      chatId: 'c1',
    })
    const subagent = route('/project/api/chat/c1/subagent/s1', {
      slug: 'api',
      chatId: 'c1',
      subagentId: 's1',
    })
    expect(mainPaneKey(chat)).toBe(mainPaneKey(subagent))
  })
})

describe('shouldFadeMainPane', () => {
  it('fades when two chat ids differ', () => {
    expect(
      shouldFadeMainPane(
        route('/chat/a', { chatId: 'a' }),
        route('/chat/b', { chatId: 'b' }),
        allowFade,
      ),
    ).toBe(true)
  })

  it('does not fade for the same chat plus a subagent id', () => {
    expect(
      shouldFadeMainPane(
        route('/chat/c1', { chatId: 'c1' }),
        route('/chat/c1/subagent/s1', {
          chatId: 'c1',
          subagentId: 's1',
        }),
        allowFade,
      ),
    ).toBe(false)
  })

  it('fades from home to a chat', () => {
    expect(
      shouldFadeMainPane(
        route('/'),
        route('/chat/c1', { chatId: 'c1' }),
        allowFade,
      ),
    ).toBe(true)
  })

  it('does not fade when only the settings section query changes', () => {
    expect(
      shouldFadeMainPane(
        route('/settings', {}, { section: 'general' }),
        route('/settings', {}, { section: 'providers' }),
        allowFade,
      ),
    ).toBe(false)
  })

  it('does not fade when only the project section query changes', () => {
    expect(
      shouldFadeMainPane(
        route('/project/api', { slug: 'api' }, { section: 'chats' }),
        route('/project/api', { slug: 'api' }, { section: 'mcp' }),
        allowFade,
      ),
    ).toBe(false)
  })

  it('does not fade when reduced motion is requested', () => {
    expect(
      shouldFadeMainPane(
        route('/'),
        route('/chat/c1', { chatId: 'c1' }),
        { ...allowFade, reducedMotion: true },
      ),
    ).toBe(false)
  })

  it('does not fade when startViewTransition is missing', () => {
    expect(
      shouldFadeMainPane(
        route('/'),
        route('/chat/c1', { chatId: 'c1' }),
        { ...allowFade, hasViewTransition: false },
      ),
    ).toBe(false)
  })

  it('does not fade when a transition is already in flight', () => {
    expect(
      shouldFadeMainPane(
        route('/'),
        route('/chat/c1', { chatId: 'c1' }),
        { ...allowFade, transitionInFlight: true },
      ),
    ).toBe(false)
  })
})
