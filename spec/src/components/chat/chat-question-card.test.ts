import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatQuestionCard from '@/components/chat/ChatQuestionCard.vue'
import type { PendingQuestionState } from '@/types/chat/pending-question'

const single: PendingQuestionState = {
  toolCallId: 'tc-single',
  question: 'Proceed?',
  options: ['Yes', 'No'],
}

const multi: PendingQuestionState = {
  toolCallId: 'tc-multi',
  question: 'Which database?',
  options: ['Postgres', 'SQLite'],
  questions: [
    { question: 'Which database?', options: ['Postgres', 'SQLite'] },
    { question: 'Which package manager?' },
  ],
}

const mountCard = (question: PendingQuestionState) =>
  mount(ChatQuestionCard, {
    props: { question },
    global: {
      stubs: {
        PromptInputSubmit: {
          template: '<button data-test="submit" @click="$emit(\'click\')" />',
        },
      },
    },
  })

const optionButton = (wrapper: ReturnType<typeof mountCard>, label: string) =>
  wrapper.findAll('button').find((button) => button.text() === label)

describe('ChatQuestionCard', () => {
  it('submits an option click for a single question', async () => {
    const wrapper = mountCard(single)
    await optionButton(wrapper, 'Yes')?.trigger('click')
    expect(wrapper.emitted('submit')).toEqual([['tc-single', 'Yes']])
  })

  it('submits a typed answer for a single question', async () => {
    const wrapper = mountCard(single)
    await wrapper.find('input').setValue('  custom answer  ')
    await wrapper.find('input').trigger('keydown.enter')
    expect(wrapper.emitted('submit')).toEqual([['tc-single', 'custom answer']])
  })

  it('steps through batched questions and submits one combined answer', async () => {
    const wrapper = mountCard(multi)
    expect(wrapper.text()).toContain('Question 1 of 2')
    expect(wrapper.text()).toContain('Which database?')

    await optionButton(wrapper, 'Postgres')?.trigger('click')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('Question 2 of 2')
    expect(wrapper.text()).toContain('Which package manager?')

    await wrapper.find('input').setValue('pnpm')
    await wrapper.find('input').trigger('keydown.enter')
    expect(wrapper.emitted('submit')).toEqual([
      [
        'tc-multi',
        '1. Which database?\nAnswer: Postgres\n\n2. Which package manager?\nAnswer: pnpm',
      ],
    ])
  })

  it('keeps answers when navigating back and forward', async () => {
    const wrapper = mountCard(multi)
    await optionButton(wrapper, 'SQLite')?.trigger('click')
    await wrapper.find('input').setValue('npm')

    await wrapper.find('button[aria-label="Previous question"]').trigger('click')
    expect(wrapper.text()).toContain('Question 1 of 2')
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('SQLite')

    await wrapper.find('button[aria-label="Next question"]').trigger('click')
    expect(wrapper.text()).toContain('Question 2 of 2')
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('npm')
  })

  it('does not advance without an answer', async () => {
    const wrapper = mountCard(multi)
    const next = wrapper.find('button[aria-label="Next question"]')
    expect(next.attributes('disabled')).toBeDefined()
    await next.trigger('click')
    expect(wrapper.text()).toContain('Question 1 of 2')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('submits only once', async () => {
    const wrapper = mountCard(single)
    await optionButton(wrapper, 'Yes')?.trigger('click')
    await wrapper.find('input').setValue('again')
    await wrapper.find('input').trigger('keydown.enter')
    expect(wrapper.emitted('submit')).toHaveLength(1)
  })
})