import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, shallowRef } from 'vue'
import type { FileUIPart } from 'ai'
import type { ContextMention } from '@/types/harness/context-mention'
import type { AgentThreadViewState } from '@/composables/agent-thread-view/types'
import { setPendingChatMessage } from '@/services/chat/pending-message'

vi.mock('@/composables/use-agent-harness', () => ({
  default: vi.fn<() => unknown>(),
}))

vi.mock('@/services/vixl/vixl-tauri', () => ({
  getUserHomeDir: vi.fn<() => Promise<string>>(),
  updateChatMeta: vi.fn<(...args: unknown[]) => Promise<void>>(),
}))

vi.mock('@/services/harness/plan-execution-session', () => ({
  clearAwaitingPlanGo: vi.fn<() => void>(),
  setSubagentModelLock: vi.fn<(...args: unknown[]) => void>(),
}))

describe('createSessionOps flushPendingChatMessage', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('passes pending files and mentions to send', async () => {
    const { createSessionOps } = await import('@/composables/agent-thread-view/session')

    const send = vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined)
    const refreshSlug = vi.fn<(slug: string) => Promise<void>>().mockResolvedValue(undefined)
    const setPermissionLevel = vi.fn<(level: string) => void>()
    const draftMentions = ref<ContextMention[]>([])

    const files: FileUIPart[] = [
      {
        type: 'file',
        mediaType: 'image/png',
        url: 'data:image/png;base64,abc',
        filename: 'element.png',
      },
    ]
    const mentions: ContextMention[] = [
      {
        type: 'browser-element',
        detail: {
          xpath: '/html[1]/body[1]/div[1]',
          cssSelector: 'div.box',
          role: 'generic',
          name: null,
          attributes: {},
          boundingBox: { x: 0, y: 0, width: 10, height: 10 },
          computedStyles: {},
          componentHint: null,
          screenshotPath: '/tmp/element.png',
          outerHTML: null,
          innerText: null,
          pageUrl: null,
          ancestorPath: null,
          matchedCss: null,
        },
        screenshotPath: '/tmp/element.png',
      },
    ]

    setPendingChatMessage({
      text: 'Inspect this',
      mode: 'agent',
      model: 'openai/gpt-4o',
      files,
      mentions,
    })

    const state = {
      isSubagentView: computed(() => false),
      harness: shallowRef({
        send,
        setPermissionLevel,
      }),
      permissionLevelTouched: ref(false),
      sessionPermissionLevel: ref('ask'),
      projectSlug: computed(() => 'home'),
      chatId: computed(() => 'chat-1'),
      contextBudgetSync: {
        draftMentions,
      },
      fleetSidebar: {
        refreshSlug,
      },
    } as unknown as AgentThreadViewState

    const session = createSessionOps(state)
    await session.flushPendingChatMessage()

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({
      text: 'Inspect this',
      mode: 'agent',
      model: 'openai/gpt-4o',
      reasoning: undefined,
      mentions,
      files,
    })
    expect(refreshSlug).toHaveBeenCalledWith('home')
  })
})
