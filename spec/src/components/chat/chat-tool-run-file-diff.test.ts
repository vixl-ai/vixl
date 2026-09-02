import { describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import ChatInlineFileDiff from '@/components/chat/InlineFileDiff.vue'
import ChatToolRun from '@/components/chat/ChatToolRun.vue'
import type { FileDiff } from '@/types/harness/file-diff'
import type { ToolRun } from '@/types/harness/tool-run'

vi.mock('@/utils/open-at-line', () => ({
  default: () => undefined,
}))

const fileDiff = (path: string): FileDiff => ({
  path,
  operation: 'update',
  hunks: [
    {
      oldStart: 1,
      newStart: 1,
      lines: [{ kind: 'add', content: 'added' }],
    },
  ],
})

const mountRun = (diffs: FileDiff[]) =>
  shallowMount(ChatToolRun, {
    props: {
      run: {
        toolCallId: 'tc-edit',
        name: 'apply_patch',
        status: 'done',
        diffs,
      } satisfies ToolRun,
    },
    global: {
      renderStubDefaultSlot: true,
      stubs: {
        AiElementsShimmerShimmer: {
          name: 'AiElementsShimmerShimmer',
          template: '<span><slot /></span>',
        },
      },
    },
  })

const diffComponents = (wrapper: ReturnType<typeof mountRun>) => {
  const byRef = wrapper.findAllComponents(ChatInlineFileDiff)
  if (byRef.length > 0) {
    return byRef
  }
  return wrapper.findAllComponents({ name: 'InlineFileDiff' })
}

describe('ChatToolRun file diffs', () => {
  it('hides the path line for a single-file edit', () => {
    const wrapper = mountRun([fileDiff('src/a.ts')])
    const diffs = diffComponents(wrapper)

    expect(diffs).toHaveLength(1)
    expect(diffs[0]?.props('showPath')).toBe(false)
  })

  it('shows a path line on each diff when there are multiple files', () => {
    const wrapper = mountRun([fileDiff('src/a.ts'), fileDiff('src/b.ts')])
    const diffs = diffComponents(wrapper)

    expect(diffs).toHaveLength(2)
    expect(diffs[0]?.props('showPath')).toBe(true)
    expect(diffs[1]?.props('showPath')).toBe(true)
  })
})
