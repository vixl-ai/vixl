import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('use-chat-prompt-bridge', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('appendMention bumps the token and consume clears the pending mention', async () => {
    const useChatPromptBridge = (await import('@/composables/use-chat-prompt-bridge')).default
    const bridge = useChatPromptBridge()

    const before = bridge.mentionAppendToken.value
    bridge.appendMention('src/utils/foo.ts')
    expect(bridge.mentionAppendToken.value).toBe(before + 1)

    const consumed = bridge.consumePendingMention()
    expect(consumed).toEqual({ type: 'file', path: 'src/utils/foo.ts' })
    expect(bridge.consumePendingMention()).toBeNull()
  })
})

