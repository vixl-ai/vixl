import { describe, expect, it } from 'vitest'
import { scrollOptionIntoMenu } from '@/components/chat/prompt-editor/scroll-option-into-menu'

const rect = (top: number, bottom: number): DOMRect => ({
  x: 0,
  y: top,
  top,
  bottom,
  left: 0,
  right: 100,
  width: 100,
  height: bottom - top,
  toJSON: () => ({}),
})

const mockRects = (
  container: HTMLElement,
  option: HTMLElement,
  containerRect: DOMRect,
  optionRect: DOMRect,
): void => {
  container.getBoundingClientRect = () => containerRect
  option.getBoundingClientRect = () => optionRect
}

describe('scrollOptionIntoMenu', () => {
  it('scrolls up when the option is above the container', () => {
    const container = document.createElement('div')
    const option = document.createElement('button')
    container.scrollTop = 80
    mockRects(container, option, rect(200, 424), rect(160, 192))

    scrollOptionIntoMenu(container, option)

    expect(container.scrollTop).toBe(40)
  })

  it('scrolls down when the option is below the container', () => {
    const container = document.createElement('div')
    const option = document.createElement('button')
    container.scrollTop = 10
    mockRects(container, option, rect(200, 424), rect(400, 440))

    scrollOptionIntoMenu(container, option)

    expect(container.scrollTop).toBe(26)
  })

  it('does not change scrollTop when the option is fully visible', () => {
    const container = document.createElement('div')
    const option = document.createElement('button')
    container.scrollTop = 48
    mockRects(container, option, rect(200, 424), rect(220, 252))

    scrollOptionIntoMenu(container, option)

    expect(container.scrollTop).toBe(48)
  })
})
