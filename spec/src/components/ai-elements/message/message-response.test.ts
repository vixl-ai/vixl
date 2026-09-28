import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import MessageResponse from '@/components/ai-elements/message/MessageResponse.vue'
import PlanMermaid from '@/components/workbench/plans/PlanMermaid.vue'

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn<(...args: unknown[]) => void>(),
    render: vi.fn<(id: string, source: string) => Promise<{ svg: string }>>(
      async () => ({
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><title>diagram</title></svg>',
      }),
    ),
  },
}))

const closedFence = [
  'Intro',
  '',
  '```mermaid',
  'flowchart TD',
  '  A --> B',
  '```',
  '',
  'Outro',
].join('\n')

const openFence = ['Intro', '', '```mermaid', 'flowchart TD', '  A --> B'].join('\n')

describe('MessageResponse mermaid', () => {
  let wrapper: VueWrapper | undefined

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
  })

  it('renders a closed mermaid fence via PlanMermaid', async () => {
    wrapper = mount(MessageResponse, {
      props: { content: closedFence },
    })
    await flushPromises()

    const diagram = wrapper.getComponent(PlanMermaid)
    expect(diagram.props('code')).toContain('flowchart TD')
    expect(diagram.props('code')).toContain('A --> B')
    expect(wrapper.html()).toContain('</svg>')
  })

  it('keeps an unclosed mermaid fence as code while streaming', async () => {
    wrapper = mount(MessageResponse, {
      props: {
        content: openFence,
        streaming: true,
      },
    })
    await flushPromises()

    expect(wrapper.findComponent(PlanMermaid).exists()).toBe(false)
    expect(wrapper.html()).not.toContain('data-stream-markdown="mermaid-previewer"')
    expect(wrapper.text()).toContain('flowchart TD')
    expect(wrapper.text()).toContain('A --> B')
  })

  it('renders PlanMermaid after a streaming fence closes', async () => {
    wrapper = mount(MessageResponse, {
      props: {
        content: openFence,
        streaming: true,
      },
    })
    await flushPromises()
    expect(wrapper.findComponent(PlanMermaid).exists()).toBe(false)

    await wrapper.setProps({ content: closedFence, streaming: true })
    await flushPromises()

    expect(wrapper.getComponent(PlanMermaid).props('code')).toContain('flowchart TD')
  })
})

const angiLeadContent = 'Next: fire the `angi_lead` trigger.'

describe('MessageResponse emphasis', () => {
  let wrapper: VueWrapper | undefined

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
  })

  it('does not append a trailing underscore while streaming angi_lead', async () => {
    wrapper = mount(MessageResponse, {
      props: {
        content: angiLeadContent,
        streaming: true,
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('angi_lead')
    expect(wrapper.text()).toContain('trigger.')
    expect(wrapper.text()).not.toMatch(/_\s*$/)
  })

  it('does not keep a trailing underscore after streaming ends', async () => {
    wrapper = mount(MessageResponse, {
      props: {
        content: angiLeadContent,
        streaming: true,
      },
    })
    await flushPromises()

    await wrapper.setProps({ streaming: false })
    await flushPromises()

    expect(wrapper.text()).toContain('angi_lead')
    expect(wrapper.text()).toContain('trigger.')
    expect(wrapper.text()).not.toMatch(/_\s*$/)
  })
})
