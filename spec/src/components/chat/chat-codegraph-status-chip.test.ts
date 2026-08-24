import { describe, expect, it } from 'vitest'
import { shouldShowChatCodegraphStatusChip } from '@/components/chat/chat-codegraph-status-chip'

describe('shouldShowChatCodegraphStatusChip', () => {
  it('hides on home-chat even when an active project slug is set', () => {
    expect(
      shouldShowChatCodegraphStatusChip({
        routeName: 'home-chat',
        routeSlug: '',
        activeProjectSlug: 'pyrola',
      }),
    ).toBe(false)
  })

  it('hides on home-chat-subagent even when an active project slug is set', () => {
    expect(
      shouldShowChatCodegraphStatusChip({
        routeName: 'home-chat-subagent',
        routeSlug: '',
        activeProjectSlug: 'pyrola',
      }),
    ).toBe(false)
  })

  it('hides when the route slug is _home_ even when an active project slug is set', () => {
    expect(
      shouldShowChatCodegraphStatusChip({
        routeName: 'chat',
        routeSlug: '_home_',
        activeProjectSlug: 'pyrola',
      }),
    ).toBe(false)
  })

  it('shows on a project chat when an active project slug is set', () => {
    expect(
      shouldShowChatCodegraphStatusChip({
        routeName: 'chat',
        routeSlug: 'pyrola',
        activeProjectSlug: 'pyrola',
      }),
    ).toBe(true)
  })

  it('hides on a project chat when there is no active project', () => {
    expect(
      shouldShowChatCodegraphStatusChip({
        routeName: 'chat',
        routeSlug: 'pyrola',
        activeProjectSlug: null,
      }),
    ).toBe(false)
  })
})
