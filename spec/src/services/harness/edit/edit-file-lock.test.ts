import { describe, expect, it, vi } from 'vitest'
import withEditFileLock from '@/services/harness/edit/edit-file-lock'

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve = (): void => undefined
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('withEditFileLock', () => {
  it('runs same-key work strictly in order', async () => {
    const order: string[] = []
    const hold = deferred()
    const first = withEditFileLock('same', async () => {
      order.push('1-start')
      await hold.promise
      order.push('1-end')
    })
    const second = withEditFileLock('same', async () => {
      order.push('2')
    })
    await vi.waitFor(() => {
      expect(order).toEqual(['1-start'])
    })
    hold.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['1-start', '1-end', '2'])
  })

  it('keeps different keys parallel', async () => {
    const order: string[] = []
    const holdA = deferred()
    const holdB = deferred()
    const first = withEditFileLock('a', async () => {
      order.push('a-start')
      await holdA.promise
      order.push('a-end')
    })
    const second = withEditFileLock('b', async () => {
      order.push('b-start')
      await holdB.promise
      order.push('b-end')
    })
    await vi.waitFor(() => {
      expect(order).toContain('a-start')
      expect(order).toContain('b-start')
      expect(order).not.toContain('a-end')
      expect(order).not.toContain('b-end')
    })
    holdB.resolve()
    holdA.resolve()
    await Promise.all([first, second])
    expect(order).toContain('a-end')
    expect(order).toContain('b-end')
  })

  it('lets later work run after a rejected predecessor', async () => {
    await expect(
      withEditFileLock('fail', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    let ran = false
    await withEditFileLock('fail', async () => {
      ran = true
    })
    expect(ran).toBe(true)
  })
})
