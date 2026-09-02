import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import InlineFileDiff from '@/components/chat/InlineFileDiff.vue'
import type { FileDiff } from '@/types/harness/file-diff'

const sampleDiff = (path: string): FileDiff => ({
  path,
  operation: 'update',
  hunks: [
    {
      oldStart: 1,
      newStart: 1,
      lines: [
        { kind: 'remove', content: 'old line' },
        { kind: 'add', content: 'new line' },
      ],
    },
  ],
})

const mountDiff = (props: { diff: FileDiff; showPath?: boolean }) =>
  mount(InlineFileDiff, { props })

describe('InlineFileDiff chrome', () => {
  it('keeps the hunk list without a muted header bar', () => {
    const wrapper = mountDiff({ diff: sampleDiff('src/foo.ts') })
    const html = wrapper.html()

    expect(html).not.toContain('bg-muted/40')
    expect(html).not.toContain('src/foo.ts')
    expect(html).not.toContain('foo.ts')
    expect(html).toContain('old line')
    expect(html).toContain('new line')
    expect(html).toContain('border-border/50')
    expect(html).toContain('font-mono')
  })

  it('shows a plain path line with counts when showPath is set', () => {
    const wrapper = mountDiff({
      diff: sampleDiff('src/bar.ts'),
      showPath: true,
    })
    const html = wrapper.html()

    expect(html).not.toContain('bg-muted/40')
    expect(wrapper.text()).toContain('src/bar.ts')
    expect(wrapper.text()).toContain('1')
    expect(html).toContain('old line')
  })
})
