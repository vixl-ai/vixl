import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserElementSelection } from '@/types/browser/browser-element-selection'

const makeSelection = (
  overrides?: Omit<Partial<BrowserElementSelection>, 'detail'> & {
    detail?: Partial<BrowserElementSelection['detail']>
  },
): BrowserElementSelection => {
  const detailOverrides = overrides?.detail
  return {
    screenshotPath: overrides?.screenshotPath ?? '/tmp/vixl/screenshots/element.png',
    screenshotBytes: overrides?.screenshotBytes ?? new Uint8Array([137, 80, 78, 71]),
    detail: {
      xpath: '/html[1]/body[1]/button[1]',
      cssSelector: 'button.primary',
      role: 'button',
      name: 'Save',
      attributes: { class: 'primary' },
      boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      computedStyles: {},
      componentHint: null,
      screenshotPath: '/tmp/vixl/screenshots/element.png',
      outerHTML: '<button class="primary">Save</button>',
      innerText: 'Save',
      pageUrl: 'https://example.com',
      ancestorPath: 'html > body > button#save.primary',
      matchedCss: 'button { color: red }',
      ...detailOverrides,
    },
  }
}

describe('use-chat-prompt-draft-media', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('appends an item with id, short label, and previewUrl', async () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:preview-1')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const useChatPromptDraftMedia = (
      await import('@/composables/use-chat-prompt-draft-media')
    ).default
    const draftMedia = useChatPromptDraftMedia()

    const item = draftMedia.append(makeSelection())

    expect(item.id.length).toBeGreaterThan(0)
    expect(item.label).toBe('button')
    expect(item.previewUrl).toBe('blob:preview-1')
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(draftMedia.items.value).toHaveLength(1)
    expect(draftMedia.items.value[0]?.id).toBe(item.id)
  })

  it('uses a short label from xpath and never embeds css or html', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const useChatPromptDraftMedia = (
      await import('@/composables/use-chat-prompt-draft-media')
    ).default
    const draftMedia = useChatPromptDraftMedia()

    const item = draftMedia.append(
      makeSelection({
        detail: {
          xpath: '/html[1]/body[1]/div[2]',
          cssSelector: 'div.box > span.long-selector',
          outerHTML: '<div class="box"><span>text</span></div>',
          matchedCss: '.box { display: flex }',
          role: 'generic',
          ancestorPath: null,
        },
      }),
    )

    expect(item.label).toBe('div')
    expect(item.label).not.toContain('box')
    expect(item.label).not.toContain('display')
    expect(item.label).not.toContain('<')
  })

  it('falls back to ancestorPath tag when xpath has no tag', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const useChatPromptDraftMedia = (
      await import('@/composables/use-chat-prompt-draft-media')
    ).default
    const draftMedia = useChatPromptDraftMedia()

    const item = draftMedia.append(
      makeSelection({
        detail: {
          xpath: '',
          ancestorPath: 'html > body > input#email',
        },
      }),
    )

    expect(item.label).toBe('input')
  })

  it('sets previewUrl null for empty screenshot bytes without throwing', async () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:should-not-run')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const useChatPromptDraftMedia = (
      await import('@/composables/use-chat-prompt-draft-media')
    ).default
    const draftMedia = useChatPromptDraftMedia()

    const item = draftMedia.append(
      makeSelection({ screenshotBytes: new Uint8Array() }),
    )

    expect(item.previewUrl).toBeNull()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('sets previewUrl null when createObjectURL throws', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('create failed')
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const useChatPromptDraftMedia = (
      await import('@/composables/use-chat-prompt-draft-media')
    ).default
    const draftMedia = useChatPromptDraftMedia()

    const item = draftMedia.append(makeSelection())

    expect(item.previewUrl).toBeNull()
  })

  it('revokes previewUrl on remove and clear', async () => {
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {})
    let previewCount = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      previewCount += 1
      return `blob:preview-${previewCount}`
    })

    const useChatPromptDraftMedia = (
      await import('@/composables/use-chat-prompt-draft-media')
    ).default
    const draftMedia = useChatPromptDraftMedia()

    const first = draftMedia.append(makeSelection())
    const second = draftMedia.append(
      makeSelection({
        detail: { xpath: '/html[1]/body[1]/a[1]' },
      }),
    )

    draftMedia.remove(first.id)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')
    expect(draftMedia.items.value).toHaveLength(1)
    expect(draftMedia.items.value[0]?.id).toBe(second.id)

    draftMedia.clear()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-2')
    expect(draftMedia.items.value).toHaveLength(0)
  })
})

describe('browser-element-media-label', () => {
  it('returns element when xpath and ancestorPath are empty', async () => {
    const browserElementMediaLabel = (
      await import('@/utils/browser-element-media-label')
    ).default
    expect(
      browserElementMediaLabel({
        xpath: '',
        ancestorPath: null,
      }),
    ).toBe('element')
  })
})
