import { describe, expect, it } from 'vitest'
import { sidebarVirtualRange } from '@/utils/sidebar-virtual-range'

const heightAt = (): number => 34

describe('sidebarVirtualRange', () => {
  it('returns an empty window for no rows', () => {
    expect(
      sidebarVirtualRange({
        count: 0,
        scrollTop: 0,
        viewport: 168,
        heightAt,
      }),
    ).toEqual({ start: 0, end: 0, offset: 0, total: 0 })
  })

  it('mounts only the viewport plus overscan from a long list', () => {
    const range = sidebarVirtualRange({
      count: 1000,
      scrollTop: 0,
      viewport: 168,
      heightAt,
      overscan: 6,
    })

    expect(range.start).toBe(0)
    expect(range.end).toBe(11)
    expect(range.offset).toBe(0)
    expect(range.total).toBe(34000)
  })

  it('keeps the window near the scroll offset', () => {
    const range = sidebarVirtualRange({
      count: 1000,
      scrollTop: 3400,
      viewport: 168,
      heightAt,
      overscan: 6,
    })

    expect(range.start).toBe(94)
    expect(range.end).toBe(111)
    expect(range.offset).toBe(94 * 34)
  })
})
