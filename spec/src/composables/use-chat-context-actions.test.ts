import { describe, expect, it } from 'vitest'
import useChatContextActions from '@/composables/use-chat-context-actions'

describe('useChatContextActions', () => {
  it('resets compacting on clear', () => {
    const actions = useChatContextActions()
    actions.compacting.value = true
    actions.clear()
    expect(actions.compacting.value).toBe(false)
  })
})
