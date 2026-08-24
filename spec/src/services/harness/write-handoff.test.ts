import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const writeTempHandoff = vi.hoisted(() =>
  vi.fn<(args: { content: string }) => Promise<{ path: string; filename: string }>>(),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    writeTempHandoff,
  }),
)

import writeHandoff from '@/services/harness/write-handoff'

describe('write-handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    writeTempHandoff.mockResolvedValue({
      path: '/tmp/handoff.md',
      filename: 'handoff.md',
    })
  })

  it('writes a markdown handoff via vixl-tauri', async () => {
    const result = await writeHandoff({
      summary: 'Finished the refactor',
      chatId: 'chat-1',
    })

    expect(result).toEqual({
      path: '/tmp/handoff.md',
      filename: 'handoff.md',
    })
    expect(writeTempHandoff).toHaveBeenCalledOnce()
    const content = writeTempHandoff.mock.calls[0]?.[0]?.content ?? ''
    expect(content).toContain('# Handoff:')
    expect(content).toContain('**Source chat:** chat-1')
    expect(content).toContain('Finished the refactor')
  })
})
