import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserElementSelection } from '@/types/browser/browser-element-selection'

describe('use-chat-prompt-bridge browser-element', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('appendBrowserElement bumps the token and consume clears the pending selection', async () => {
    const useChatPromptBridge = (await import('@/composables/use-chat-prompt-bridge')).default
    const bridge = useChatPromptBridge()

    const selection: BrowserElementSelection = {
      screenshotPath: '/tmp/vixl/screenshots/element.png',
      screenshotBytes: new Uint8Array([1, 2, 3]),
      detail: {
        xpath: '/html[1]/body[1]/div[1]',
        cssSelector: 'div.box',
        role: 'generic',
        name: null,
        attributes: {},
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        computedStyles: {},
        componentHint: null,
        screenshotPath: '/tmp/vixl/screenshots/element.png',
        outerHTML: null,
        innerText: null,
        pageUrl: null,
        ancestorPath: null,
        matchedCss: null,
      },
    }

    const before = bridge.browserElementAppendToken.value
    bridge.appendBrowserElement(selection)
    expect(bridge.browserElementAppendToken.value).toBe(before + 1)

    const consumed = bridge.consumePendingBrowserElement()
    expect(consumed).toEqual(selection)
    expect(bridge.consumePendingBrowserElement()).toBeNull()
  })
})
