import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const { fsReadFile, fsWriteFile, fsListDir } = vi.hoisted(() => ({
  fsReadFile: vi.fn<
    (args: { projectRoot: string; path: string }) => Promise<{ content: string }>
  >(),
  fsWriteFile: vi.fn<
    (args: { projectRoot: string; path: string; content: string }) => Promise<unknown>
  >(),
  fsListDir: vi.fn<
    (
      projectRoot: string,
      path: string,
    ) => Promise<Array<{ name: string; path: string; kind: string }>>
  >(),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    fsReadFile,
    fsWriteFile,
    fsListDir,
  }),
)

import clearBuildChatRef from '@/services/plans/clear-build-chat-ref'

const PROJECT_ROOT = '/repo'
const MATCHING_PLAN = `---
id: match-plan
title: Match
createdAt: 2026-09-09T18:00:00.000Z
mode: plan
lastBuildChatId: gone-chat
lastBuildChatSlug: stack
builtAt: 2026-09-09T18:00:00.000Z
lastBuildModel: gpt-4
todos: []
---

## Goal

Ship it.
`

const OTHER_PLAN = `---
id: other-plan
title: Other
createdAt: 2026-09-09T18:00:00.000Z
mode: plan
lastBuildChatId: keep-chat
builtAt: 2026-09-09T18:00:00.000Z
lastBuildModel: gpt-4
todos: []
---

## Goal

Ship it.
`

describe('clear-build-chat-ref', () => {
  beforeEach(() => {
    fsReadFile.mockReset()
    fsWriteFile.mockReset()
    fsListDir.mockReset()
    fsWriteFile.mockResolvedValue(undefined)
    fsListDir.mockResolvedValue([
      { name: 'match-plan', path: '.vixl/plans/match-plan', kind: 'directory' },
      { name: 'other-plan', path: '.vixl/plans/other-plan', kind: 'directory' },
    ])
    fsReadFile.mockImplementation(async ({ path }) => {
      if (path.includes('match-plan')) {
        return { content: MATCHING_PLAN }
      }
      return { content: OTHER_PLAN }
    })
  })

  it('clears lastBuildChatId, lastBuildChatSlug, and builtAt on matching plans only', async () => {
    await clearBuildChatRef({
      projectRoot: PROJECT_ROOT,
      chatId: 'gone-chat',
    })

    expect(fsWriteFile).toHaveBeenCalledTimes(1)
    const written = fsWriteFile.mock.calls[0]?.[0]
    expect(written?.path).toBe('.vixl/plans/match-plan/PLAN.md')
    expect(written?.content).not.toContain('lastBuildChatId:')
    expect(written?.content).not.toContain('lastBuildChatSlug:')
    expect(written?.content).not.toContain('builtAt:')
    expect(written?.content).toContain('lastBuildModel: gpt-4')
    expect(written?.content).toContain('id: match-plan')
  })

  it('returns when the plans directory is missing', async () => {
    fsListDir.mockRejectedValue(new Error('No such file'))
    await clearBuildChatRef({
      projectRoot: PROJECT_ROOT,
      chatId: 'gone-chat',
    })
    expect(fsReadFile).not.toHaveBeenCalled()
    expect(fsWriteFile).not.toHaveBeenCalled()
  })

  it('skips unreadable plans and still clears matches', async () => {
    fsReadFile.mockImplementation(async ({ path }) => {
      if (path.includes('other-plan')) {
        throw new Error('read failed')
      }
      return { content: MATCHING_PLAN }
    })
    await clearBuildChatRef({
      projectRoot: PROJECT_ROOT,
      chatId: 'gone-chat',
    })
    expect(fsWriteFile).toHaveBeenCalledTimes(1)
    expect(fsWriteFile.mock.calls[0]?.[0].path).toBe('.vixl/plans/match-plan/PLAN.md')
  })
})
