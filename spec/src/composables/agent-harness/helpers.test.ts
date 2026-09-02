import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { AgentHarnessState } from '@/composables/agent-harness/types'

vi.mock('@/services/harness/subagent/registry', () => ({
  hasPendingBackgroundResume: () => false,
  hasRunningSubagentsForChat: () => false,
}))

vi.mock('@/services/vixl/vixl-tauri', () => ({
  updateChatMeta: vi.fn<(...args: unknown[]) => Promise<void>>(),
}))

import createHelpers from '@/composables/agent-harness/helpers'

const buildState = (overrides?: {
  status?: 'ready' | 'streaming' | 'submitted'
  compacting?: boolean
  resumingBackgroundBatch?: boolean
}): AgentHarnessState =>
  ({
    options: { projectSlug: 'proj', chatId: 'chat-1' },
    session: {
      meta: ref(null),
      pendingQuestion: ref(null),
      patchMeta: vi.fn<(patch: unknown) => void>(),
    },
    status: ref(overrides?.status ?? 'ready'),
    compacting: ref(overrides?.compacting ?? false),
    resumingBackgroundBatch: ref(overrides?.resumingBackgroundBatch ?? false),
    pendingApprovals: ref([]),
    pendingMcpAuth: ref([]),
    fleetSidebar: {
      refreshSlug: vi.fn<(slug: string) => Promise<void>>().mockResolvedValue(undefined),
    },
    chatStore: {
      isSessionActive: () => true,
    },
  }) as unknown as AgentHarnessState

describe('agent-harness helpers isParentBusy', () => {
  it('is true while compacting', () => {
    const attention = createHelpers(buildState({ compacting: true }))
    expect(attention.isParentBusy()).toBe(true)
    expect(attention.isFullyIdle()).toBe(false)
  })

  it('is false when ready and not compacting', () => {
    const attention = createHelpers(buildState())
    expect(attention.isParentBusy()).toBe(false)
  })

  it('is true while streaming even if not compacting', () => {
    const attention = createHelpers(buildState({ status: 'streaming' }))
    expect(attention.isParentBusy()).toBe(true)
  })
})
