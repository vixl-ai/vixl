import { describe, expect, it } from 'vitest'
import {
  WINDOW_RESIZE_HANDLE_DIRECTIONS,
  shouldShowWindowResizeHandles,
} from '@/components/navigation/header/window-resize-handles'

describe('shouldShowWindowResizeHandles', () => {
  it('shows when undecorated and not maximized', () => {
    expect(
      shouldShowWindowResizeHandles({ isDecorated: false, isMaximized: false }),
    ).toBe(true)
  })

  it('hides when undecorated and maximized', () => {
    expect(
      shouldShowWindowResizeHandles({ isDecorated: false, isMaximized: true }),
    ).toBe(false)
  })

  it('hides when decorated and not maximized', () => {
    expect(
      shouldShowWindowResizeHandles({ isDecorated: true, isMaximized: false }),
    ).toBe(false)
  })

  it('hides when decorated and maximized', () => {
    expect(
      shouldShowWindowResizeHandles({ isDecorated: true, isMaximized: true }),
    ).toBe(false)
  })
})

describe('WINDOW_RESIZE_HANDLE_DIRECTIONS', () => {
  it('maps all eight sides to Tauri resize directions', () => {
    expect(WINDOW_RESIZE_HANDLE_DIRECTIONS).toEqual({
      n: 'North',
      s: 'South',
      e: 'East',
      w: 'West',
      ne: 'NorthEast',
      nw: 'NorthWest',
      se: 'SouthEast',
      sw: 'SouthWest',
    })
  })
})
