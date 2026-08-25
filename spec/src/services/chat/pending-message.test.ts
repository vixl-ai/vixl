import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileUIPart } from 'ai'
import type { ContextMention } from '@/types/harness/context-mention'
import {
  PENDING_CHAT_MESSAGE_EVENT,
  consumePendingChatMessage,
  setPendingChatMessage,
  type PendingChatMessage,
} from '@/services/chat/pending-message'

describe('pending-message', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('round-trips files and mentions through set then consume', () => {
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
        type: 'file',
        path: 'src/utils/foo.ts',
      },
    ]
    const payload: PendingChatMessage = {
      text: 'Inspect this',
      mode: 'agent',
      model: 'openai/gpt-4o',
      files,
      mentions,
    }

    setPendingChatMessage(payload)
    const consumed = consumePendingChatMessage()

    expect(consumed).toEqual(payload)
    expect(consumePendingChatMessage()).toBeNull()
  })

  it('dispatches the pending message event', () => {
    const listener = vi.fn<(event: Event) => void>()
    window.addEventListener(PENDING_CHAT_MESSAGE_EVENT, listener)
    try {
      setPendingChatMessage({
        text: 'hi',
        mode: 'agent',
        model: 'openai/gpt-4o',
      })
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(PENDING_CHAT_MESSAGE_EVENT, listener)
    }
  })

  it('falls back to text-only when sessionStorage quota is exceeded', () => {
    const files: FileUIPart[] = [
      {
        type: 'file',
        mediaType: 'image/png',
        url: `data:image/png;base64,${'a'.repeat(100)}`,
        filename: 'big.png',
      },
    ]
    const store = new Map<string, string>()
    let failNextWrite = true
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failNextWrite) {
          failNextWrite = false
          throw new DOMException('QuotaExceededError')
        }
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => {
        store.clear()
      },
      key: () => null,
      get length() {
        return store.size
      },
    })

    setPendingChatMessage({
      text: 'Inspect this',
      mode: 'agent',
      model: 'openai/gpt-4o',
      permissionLevel: 'ask',
      files,
      mentions: [{ type: 'file', path: 'src/app.ts' }],
    })

    const consumed = consumePendingChatMessage()
    expect(consumed).toEqual({
      text: 'Inspect this',
      mode: 'agent',
      model: 'openai/gpt-4o',
      permissionLevel: 'ask',
    })
    expect(consumed?.files).toBeUndefined()
    expect(consumed?.mentions).toBeUndefined()
  })
})
