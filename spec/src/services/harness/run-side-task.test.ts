import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const generateText = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{ text: string; usage?: unknown }>>(),
)
const createModel = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)
const captureBillableUsage = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(),
)
const loadPrompt = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => string>(() => 'title prompt'),
)
const updateChatMeta = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)
const refreshFleetSidebar = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)
const toastError = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => generateText(...args),
}))

vi.mock('@/services/providers/create-model', () => ({
  default: (...args: unknown[]) => createModel(...args),
}))

vi.mock('@/services/billing/capture-billable-usage', () => ({
  default: (...args: unknown[]) => captureBillableUsage(...args),
}))

vi.mock('@/services/prompts/load-prompt', () => ({
  default: (...args: unknown[]) => loadPrompt(...args),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    updateChatMeta: (...args: unknown[]) => updateChatMeta(...args),
  }),
)

vi.mock('@/composables/use-fleet-sidebar', () => ({
  refreshFleetSidebar: (...args: unknown[]) => refreshFleetSidebar(...args),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}))

import runSideTask from '@/services/harness/run-side-task'

const baseSettings = (): VixlSettings =>
  ({
    version: 1,
    'models.title': 'ollama::qwen',
    'chat.autoTitle': true,
  }) as VixlSettings

const baseInput = () => ({
  projectSlug: 'proj',
  chatId: 'chat-1',
  prompt: 'Please refactor the auth module carefully',
  settings: baseSettings(),
  fallbackProviderId: 'openai',
  fallbackModelId: 'gpt-4o',
})

describe('runSideTask chat title fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createModel.mockResolvedValue({ id: 'stub-model' })
    updateChatMeta.mockResolvedValue(undefined)
    refreshFleetSidebar.mockResolvedValue(undefined)
    loadPrompt.mockReturnValue('title prompt')
  })

  it('retries distinct chat fallback when primary throws, persists title, no toast', async () => {
    generateText
      .mockRejectedValueOnce(new Error('primary unavailable'))
      .mockResolvedValueOnce({ text: 'Auth Refactor' })

    const title = await runSideTask(baseInput())

    expect(title).toBe('Auth Refactor')
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(createModel).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        providerId: 'ollama',
        modelId: 'qwen',
      }),
    )
    expect(createModel).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        providerId: 'openai',
        modelId: 'gpt-4o',
      }),
    )
    expect(updateChatMeta).toHaveBeenCalledWith('proj', 'chat-1', {
      title: 'Auth Refactor',
    })
    expect(refreshFleetSidebar).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('toasts and returns null when primary throws with no fallback', async () => {
    generateText.mockRejectedValueOnce(new Error('primary unavailable'))

    const title = await runSideTask({
      ...baseInput(),
      fallbackProviderId: undefined,
      fallbackModelId: undefined,
    })

    expect(title).toBeNull()
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(createModel).toHaveBeenCalledTimes(1)
    expect(updateChatMeta).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith(
      'Failed to generate chat title',
      expect.objectContaining({
        description: 'primary unavailable',
      }),
    )
  })

  it('toasts and does not retry when fallback is the same model as primary', async () => {
    generateText.mockRejectedValueOnce(new Error('primary unavailable'))

    const title = await runSideTask({
      ...baseInput(),
      fallbackProviderId: 'ollama',
      fallbackModelId: 'qwen',
    })

    expect(title).toBeNull()
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(createModel).toHaveBeenCalledTimes(1)
    expect(updateChatMeta).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith(
      'Failed to generate chat title',
      expect.objectContaining({
        description: 'primary unavailable',
      }),
    )
  })

  it('returns null without retry when primary passes quality-gate reject', async () => {
    generateText.mockResolvedValueOnce({ text: 'New Agent' })

    const title = await runSideTask(baseInput())

    expect(title).toBeNull()
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(createModel).toHaveBeenCalledTimes(1)
    expect(updateChatMeta).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('persists title on happy path with no toast', async () => {
    generateText.mockResolvedValueOnce({ text: 'Auth Refactor' })

    const title = await runSideTask(baseInput())

    expect(title).toBe('Auth Refactor')
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(createModel).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'ollama',
        modelId: 'qwen',
        disableThinking: true,
      }),
    )
    expect(updateChatMeta).toHaveBeenCalledWith('proj', 'chat-1', {
      title: 'Auth Refactor',
    })
    expect(refreshFleetSidebar).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()
  })
})
