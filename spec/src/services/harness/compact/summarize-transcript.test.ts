import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const generateText = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{ text: string; usage?: unknown }>>(),
)
const createModel = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)
const loadPrompt = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => string>(() => 'compact prompt'),
)

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => generateText(...args),
}))

vi.mock('@/services/providers/create-model', () => ({
  default: (...args: unknown[]) => createModel(...args),
}))

vi.mock('@/services/prompts/load-prompt', () => ({
  default: (...args: unknown[]) => loadPrompt(...args),
}))

import {
  compactBudgets,
  summarizeTranscript,
} from '@/services/harness/compact'

const baseSettings = (): VixlSettings =>
  ({
    version: 1,
    'models.default': 'ollama::qwen',
  }) as VixlSettings

describe('summarizeTranscript', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createModel.mockResolvedValue({ id: 'stub-model' })
    loadPrompt.mockReturnValue('compact prompt')
  })

  it('returns a trimmed summary without billing', async () => {
    generateText.mockResolvedValueOnce({
      text: '  Auth is broken at token refresh.  ',
      usage: { inputTokens: 10, outputTokens: 4 },
    })

    const result = await summarizeTranscript({
      settings: baseSettings(),
      transcript: 'USER:\nfix auth',
    })

    expect(result.summary).toBe('Auth is broken at token refresh.')
    expect(result.modelRef).toEqual({
      providerId: 'ollama',
      modelId: 'qwen',
    })
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: compactBudgets.COMPACT_MAX_OUTPUT_TOKENS,
        prompt: expect.stringContaining('USER:\nfix auth'),
      }),
    )
    expect(loadPrompt).toHaveBeenCalledWith('system/compact.md', {
      focus: 'none',
    })
    expect(createModel).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'ollama',
        modelId: 'qwen',
      }),
    )
  })

  it('throws when compaction returns empty text', async () => {
    generateText.mockResolvedValueOnce({ text: '   ' })

    await expect(
      summarizeTranscript({
        settings: baseSettings(),
        transcript: 'USER:\nfix auth',
      }),
    ).rejects.toThrow('Compaction returned empty summary')
  })
})
