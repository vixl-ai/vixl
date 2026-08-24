import { describe, expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import ChatToolCard from '@/components/chat/ChatToolCard.vue'
import { CollapsibleTrigger } from '@/components/shadcn/ui/collapsible'
import type { PendingApprovalView } from '@/services/harness/permission/gate'

const approval: PendingApprovalView = {
  toolCallId: 'tc-write',
  name: 'write',
  kind: 'fs',
  title: 'Write src/foo.ts',
  allowedScopes: [],
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
})
