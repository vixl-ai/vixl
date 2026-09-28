import { afterEach, describe, expect, it, vi } from 'vitest'
import { shallowMount, type VueWrapper } from '@vue/test-utils'

vi.hoisted(() => {
  Object.defineProperty(document, 'queryCommandSupported', {
    configurable: true,
    value: () => false,
  })
})

import ChatAgentTurn from '@/components/chat/ChatAgentTurn.vue'
import { Button } from '@/components/shadcn/ui/button'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { AgentTurnErrorKind } from '@/types/chat/agent-turn-error'

const erroredTurn = (kind: AgentTurnErrorKind = 'error'): AgentTurn => ({
  id: 't1',
  text: 'partial answer',
  error: { kind, message: 'provider failed' },
  steps: [
    {
      id: 't1-step',
      text: '',
      reasoning: '',
      tools: [],
    },
  ],
})

let wrapper: VueWrapper | null = null

const mountTurn = (props: {
  turn?: AgentTurn
  canContinue?: boolean
}): VueWrapper => {
  wrapper = shallowMount(ChatAgentTurn, {
    props: {
      turn: props.turn ?? erroredTurn(),
      canContinue: props.canContinue,
    },
    global: {
      renderStubDefaultSlot: true,
      stubs: {
        ChatAgentTurnUsage: true,
      },
    },
  })
  return wrapper
}

const buttonByLabel = (mounted: VueWrapper, label: string) =>
  mounted.findAllComponents(Button).find((button) => button.text().includes(label))

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('ChatAgentTurn continue', () => {
  it('shows Continue only when canContinue is true and the turn has an error', () => {
    const withContinue = mountTurn({ canContinue: true })
    expect(buttonByLabel(withContinue, 'Continue')?.exists()).toBe(true)
    expect(buttonByLabel(withContinue, 'Retry')?.exists()).toBe(true)
    withContinue.unmount()

    const withoutFlag = mountTurn({ canContinue: false })
    expect(buttonByLabel(withoutFlag, 'Continue')).toBeUndefined()
    expect(buttonByLabel(withoutFlag, 'Retry')?.exists()).toBe(true)
    withoutFlag.unmount()

    const noError: AgentTurn = {
      id: 't1',
      text: 'done',
      steps: [{ id: 't1-step', text: '', reasoning: '', tools: [] }],
    }
    const withoutError = mountTurn({ turn: noError, canContinue: true })
    expect(buttonByLabel(withoutError, 'Continue')).toBeUndefined()
    expect(buttonByLabel(withoutError, 'Retry')).toBeUndefined()
  })

  it('does not show Continue or Retry for aborted errors', () => {
    const mounted = mountTurn({
      turn: erroredTurn('aborted'),
      canContinue: true,
    })
    expect(buttonByLabel(mounted, 'Continue')).toBeUndefined()
    expect(buttonByLabel(mounted, 'Retry')).toBeUndefined()
  })

  it('emits continue when Continue is clicked', async () => {
    const mounted = mountTurn({ canContinue: true })
    const continueButton = buttonByLabel(mounted, 'Continue')
    expect(continueButton).toBeDefined()
    await continueButton!.trigger('click')
    expect(mounted.emitted('continue')).toHaveLength(1)
  })

  it('emits retry when Retry is clicked while Continue is shown', async () => {
    const mounted = mountTurn({ canContinue: true })
    const retryButton = buttonByLabel(mounted, 'Retry')
    expect(retryButton).toBeDefined()
    await retryButton!.trigger('click')
    expect(mounted.emitted('retry')).toHaveLength(1)
    expect(mounted.emitted('continue')).toBeUndefined()
  })
})
