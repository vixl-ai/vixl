import { describe, expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import ChatInlineFileDiff from '@/components/chat/InlineFileDiff.vue'
import ChatToolCard from '@/components/chat/ChatToolCard.vue'
import { CollapsibleTrigger } from '@/components/shadcn/ui/collapsible'
import type { FileDiff } from '@/types/harness/file-diff'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import { WifiIcon } from '@lucide/vue'

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

const approval: PendingApprovalView = {
  toolCallId: 'tc-write',
  name: 'write',
  kind: 'fs',
  title: 'Write src/foo.ts',
  allowedScopes: [],
}

const networkApproval: PendingApprovalView = {
  toolCallId: 'tc-curl',
  name: 'run_terminal',
  kind: 'shell',
  title: 'curl example.com',
  allowedScopes: ['once', 'session'],
  needsNetwork: true,
}

const mountCard = () =>
  shallowMount(ChatToolCard, {
    props: { approval },
    global: {
      renderStubDefaultSlot: true,
    },
  })

const trigger = (wrapper: ReturnType<typeof mountCard>) => {
  const byRef = wrapper.findAllComponents(CollapsibleTrigger)
  if (byRef.length > 0) {
    return byRef[0]
  }
  return wrapper.findAllComponents({ name: 'CollapsibleTrigger' })[0]
}

describe('ChatToolCard layout', () => {
  it('centers the collapsible trigger row without a bottom border', () => {
    const wrapper = mountCard()
    const triggerClass = String(
      trigger(wrapper)?.attributes('class') ?? trigger(wrapper)?.classes().join(' ') ?? '',
    )
    expect(triggerClass).toContain('flex')
    expect(triggerClass).toContain('items-center')
    expect(triggerClass).toContain('gap-2')
    expect(triggerClass).not.toContain('border-b')
  })

  it('shows a wifi icon next to the title when needsNetwork is set', () => {
    const wrapper = shallowMount(ChatToolCard, {
      props: { approval: networkApproval },
      global: {
        renderStubDefaultSlot: true,
      },
    })
    expect(wrapper.findComponent(WifiIcon).exists()).toBe(true)
    expect(wrapper.html()).toContain('This command uses network in the sandbox')
  })

  it('hides the wifi icon when the approval does not need network', () => {
    const wrapper = mountCard()
    expect(wrapper.findComponent(WifiIcon).exists()).toBe(false)
  })

  it('shows the wifi icon from the network-denied detail fallback', () => {
    const wrapper = shallowMount(ChatToolCard, {
      props: {
        approval: {
          ...networkApproval,
          needsNetwork: undefined,
          detail:
            'SANDBOX_RUNTIME_BLOCKED: Sandbox blocked this command (network denied).',
        },
      },
      global: {
        renderStubDefaultSlot: true,
      },
    })
    expect(wrapper.findComponent(WifiIcon).exists()).toBe(true)
  })

  it('does not put a wifi action on the approval buttons when needsNetwork is set', async () => {
    const { default: ChatApprovalActions } = await import(
      '@/components/chat/ChatApprovalActions.vue'
    )
    const wrapper = shallowMount(ChatApprovalActions, {
      props: { approval: networkApproval },
      global: {
        renderStubDefaultSlot: true,
      },
    })
    expect(wrapper.findComponent(WifiIcon).exists()).toBe(false)
    expect(wrapper.html()).toContain('Allow once')
    expect(wrapper.html()).toContain('Allow session')
    expect(wrapper.html()).not.toContain('Allow network in sandbox')
  })

  it('hides the path line for a single-file fs approval', () => {
    const wrapper = shallowMount(ChatToolCard, {
      props: {
        approval: {
          ...approval,
          diff: [fileDiff('src/foo.ts')],
        },
      },
      global: {
        renderStubDefaultSlot: true,
      },
    })
    const diffs = wrapper.findAllComponents(ChatInlineFileDiff)

    expect(diffs).toHaveLength(1)
    expect(diffs[0]?.props('showPath')).toBe(false)
  })

  it('shows a path line on each diff for multi-file fs approval', () => {
    const wrapper = shallowMount(ChatToolCard, {
      props: {
        approval: {
          ...approval,
          diff: [fileDiff('src/a.ts'), fileDiff('src/b.ts')],
        },
      },
      global: {
        renderStubDefaultSlot: true,
      },
    })
    const diffs = wrapper.findAllComponents(ChatInlineFileDiff)

    expect(diffs).toHaveLength(2)
    expect(diffs[0]?.props('showPath')).toBe(true)
    expect(diffs[1]?.props('showPath')).toBe(true)
  })
})
