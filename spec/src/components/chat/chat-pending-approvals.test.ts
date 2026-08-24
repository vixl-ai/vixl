import { describe, expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import ChatPendingApprovals from '@/components/chat/ChatPendingApprovals.vue'
import ChatToolCard from '@/components/chat/ChatToolCard.vue'
import type { ApprovalResolution } from '@/services/harness/permission/approval-gate'
import type { PendingApprovalView } from '@/services/harness/permission/gate'

const labeled: PendingApprovalView = {
  toolCallId: 'tc-sub',
  name: 'write',
  kind: 'fs',
  title: 'Write src/foo.ts',
  allowedScopes: [],
  subagentId: 'sa-explore',
  subagentLabel: 'Sub-agent: explore',
}

const unlabeled: PendingApprovalView = {
  toolCallId: 'tc-parent',
  name: 'run_terminal',
  kind: 'shell',
  title: 'Run ls',
  allowedScopes: [],
}

const approvals = [labeled, unlabeled]

const mountBar = () =>
  shallowMount(ChatPendingApprovals, {
    props: { approvals },
  })

const cardStubs = (wrapper: ReturnType<typeof mountBar>) => {
  const byRef = wrapper.findAllComponents(ChatToolCard)
  if (byRef.length > 0) {
    return byRef
  }
  return wrapper.findAllComponents({ name: 'ChatToolCard' })
}

describe('ChatPendingApprovals', () => {
  it('renders one ChatToolCard per approval', () => {
    const wrapper = mountBar()
    expect(cardStubs(wrapper)).toHaveLength(approvals.length)
  })

  it('passes approval and subagentLabel to each card', () => {
    const stubs = cardStubs(mountBar())
    expect(stubs[0]?.props()).toMatchObject({
      approval: expect.objectContaining({ toolCallId: labeled.toolCallId }),
      subagentLabel: labeled.subagentLabel,
    })
    expect(stubs[1]?.props()).toMatchObject({
      approval: expect.objectContaining({ toolCallId: unlabeled.toolCallId }),
      subagentLabel: undefined,
    })
  })

  it('emits resolve with toolCallId and resolution when a card resolves', () => {
    const wrapper = mountBar()
    const resolution: ApprovalResolution = { approved: true, scope: 'once' }
    cardStubs(wrapper)[0]?.vm.$emit('resolve', resolution)
    expect(wrapper.emitted('resolve')).toEqual([[labeled.toolCallId, resolution]])
  })
})
