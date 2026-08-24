import { describe, expect, it } from 'vitest'
import {
  formatMentionBlocks,
  formatMentionsAsText,
} from '@/services/context/system-prompt-parts/format-mentions'
import type { ContextMention } from '@/types/harness/context-mention'

const browserElementMention: ContextMention = {
  type: 'browser-element',
  screenshotPath: '/tmp/vixl/screenshots/element.png',
  detail: {
    xpath: '/html[1]/body[1]/button[1]',
    cssSelector: 'button.submit',
    role: 'button',
    name: 'Submit',
    attributes: { type: 'submit', class: 'primary' },
    boundingBox: { x: 10, y: 20, width: 100, height: 40 },
    computedStyles: {
      display: 'inline-block',
      color: 'rgb(0, 0, 0)',
    },
    componentHint: null,
    screenshotPath: '/tmp/vixl/screenshots/element.png',
    outerHTML: null,
    innerText: null,
    pageUrl: null,
    ancestorPath: null,
    matchedCss: null,
  },
}

describe('format-mentions browser-element', () => {
  it('formats a browser-element mention as a readable text block', () => {
    const text = formatMentionsAsText([browserElementMention])

    expect(text).toContain('Browser element button (/html[1]/body[1]/button[1]):')
    expect(text).toContain('role: button')
    expect(text).toContain('name: Submit')
    expect(text).toContain('attributes: type=submit; class=primary')
    expect(text).toContain('boundingBox: 10,20 100,40')
    expect(text).toContain('computedStyles: display: inline-block; color: rgb(0, 0, 0)')
    expect(text).toContain('screenshot: /tmp/vixl/screenshots/element.png')
  })

  it('includes browser-element in formatMentionBlocks mentions', () => {
    const blocks = formatMentionBlocks([
      browserElementMention,
      { type: 'skill', name: 'ask' },
    ])

    expect(blocks.skills).toBe('Skill ask')
    expect(blocks.mentions).toContain('Browser element button')
    expect(blocks.mentions).toContain('screenshot: /tmp/vixl/screenshots/element.png')
  })
})
