import { beforeEach, describe, expect, it } from 'vitest'
import forgetResumeOverlayDelivery from '@/services/harness/orchestrator/forget-resume-overlay-delivery'
import loadResumeOverlay from '@/services/harness/orchestrator/load-resume-overlay'
import resetResumeOverlay from '@/services/harness/orchestrator/reset-resume-overlay'
import itemsByChat from '@/services/harness/orchestrator/resume-overlay-cache'

describe('forgetResumeOverlayDelivery', () => {
  beforeEach(() => {
    resetResumeOverlay()
  })

  it('clears matching result keys and keeps wake replay content', () => {
    itemsByChat.set('chat-1', [
      {
        kind: 'spawn',
        id: 'spawn-1',
        messages: [{ role: 'assistant', content: 'spawn turn' }],
      },
      {
        kind: 'wake',
        id: 'wake-1',
        content: 'first wake with mapped the repo',
        toolCallIds: ['tc-1', 'tc-2'],
        resultKeys: ['tc-1:mapped the repo', 'tc-2:drafted the patch'],
      },
    ])

    forgetResumeOverlayDelivery({ chatId: 'chat-1', toolCallId: 'tc-1' })

    const overlay = loadResumeOverlay('chat-1')
    expect(overlay.deliveredResultKeys).toEqual(['tc-2:drafted the patch'])
    expect(overlay.wakes).toEqual([
      {
        content: 'first wake with mapped the repo',
        toolCallIds: ['tc-1', 'tc-2'],
      },
    ])
    expect(overlay.spawnMessages).toEqual([
      { role: 'assistant', content: 'spawn turn' },
    ])
  })

  it('does not touch another chat or a toolCallId prefix neighbor', () => {
    itemsByChat.set('chat-1', [
      {
        kind: 'wake',
        id: 'wake-1',
        content: 'chat one',
        toolCallIds: ['tc-1', 'tc-10'],
        resultKeys: ['tc-1:mapped', 'tc-10:other'],
      },
    ])
    itemsByChat.set('chat-2', [
      {
        kind: 'wake',
        id: 'wake-2',
        content: 'chat two',
        toolCallIds: ['tc-1'],
        resultKeys: ['tc-1:mapped'],
      },
    ])

    forgetResumeOverlayDelivery({ chatId: 'chat-1', toolCallId: 'tc-1' })

    expect(loadResumeOverlay('chat-1').deliveredResultKeys).toEqual(['tc-10:other'])
    expect(loadResumeOverlay('chat-2').deliveredResultKeys).toEqual(['tc-1:mapped'])
    expect(loadResumeOverlay('chat-2').wakes[0]?.content).toBe('chat two')
  })
})
